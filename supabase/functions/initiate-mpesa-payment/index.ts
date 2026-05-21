// ============================================================================
// initiate-mpesa-payment – Supabase Edge Function (Deno)
// Calls Safaricom STK Push API, stores CheckoutRequestID, logs transaction.
// ============================================================================

/// <reference lib="deno.ns" />
/// <reference lib="deno.unstable" />

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Environment variables (set in Supabase dashboard)
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MPESA_CONSUMER_KEY = Deno.env.get('MPESA_CONSUMER_KEY')!;
const MPESA_CONSUMER_SECRET = Deno.env.get('MPESA_CONSUMER_SECRET')!;
const MPESA_PASSKEY = Deno.env.get('MPESA_PASSKEY')!;
const MPESA_SHORTCODE = Deno.env.get('MPESA_SHORTCODE')!;
const MPESA_ENV = Deno.env.get('MPESA_ENV') || 'sandbox';
const MPESA_CALLBACK_URL = Deno.env.get('MPESA_CALLBACK_URL')!;

const baseUrl = MPESA_ENV === 'sandbox'
    ? 'https://sandbox.safaricom.co.ke'
    : 'https://api.safaricom.co.ke';

// Helper: get OAuth access token
async function getAccessToken(): Promise<string> {
    const auth = btoa(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`);
    const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` }
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to get access token: ${res.status} ${errorText}`);
    }
    const data = await res.json() as { access_token: string };
    return data.access_token;
}

// Helper: format phone number to 254XXXXXXXXX (12 digits)
function formatPhoneNumber(raw: string): string {
    let cleaned = raw.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.slice(1);
    }
    if (!cleaned.startsWith('254')) {
        cleaned = '254' + cleaned;
    }
    if (cleaned.length !== 12) {
        throw new Error(`Invalid phone number length after formatting: ${cleaned} (expected 12 digits)`);
    }
    return cleaned;
}

interface STKPushPayload {
    BusinessShortCode: string;
    Password: string;
    Timestamp: string;
    TransactionType: string;
    Amount: number;
    PartyA: string;
    PartyB: string;
    PhoneNumber: string;
    CallBackURL: string;
    AccountReference: string;
    TransactionDesc: string;
}

interface STKPushResponse {
    ResponseCode: string;
    ResponseDescription?: string;
    CheckoutRequestID?: string;
}

serve(async (req: Request) => {
    // Only accept POST
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const body = await req.json() as {
            sale_id: number;
            phone_number: string;
            amount: number;
            transaction_number: string;
        };
        const { sale_id, phone_number, amount, transaction_number } = body;

        if (!sale_id || !phone_number || !amount || !transaction_number) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
        }

        console.log(`Initiating M-Pesa payment for sale ${sale_id}, amount ${amount}`);

        let formattedPhone: string;
        try {
            formattedPhone = formatPhoneNumber(phone_number);
        } catch (err) {
            return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
        }

        let accessToken: string;
        try {
            accessToken = await getAccessToken();
        } catch (err) {
            console.error('Access token error:', (err as Error).message);
            return new Response(JSON.stringify({ error: 'Failed to authenticate with M-Pesa' }), { status: 500 });
        }

        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const password = btoa(MPESA_SHORTCODE + MPESA_PASSKEY + timestamp);

        const stkPushPayload: STKPushPayload = {
            BusinessShortCode: MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: Math.round(amount),
            PartyA: formattedPhone,
            PartyB: MPESA_SHORTCODE,
            PhoneNumber: formattedPhone,
            CallBackURL: MPESA_CALLBACK_URL,
            AccountReference: transaction_number,
            TransactionDesc: `VendGrid payment ${transaction_number}`
        };

        console.log('STK push payload:', JSON.stringify(stkPushPayload, null, 2));

        const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(stkPushPayload)
        });

        const stkData = await stkRes.json() as STKPushResponse;
        console.log('STK push response:', JSON.stringify(stkData, null, 2));

        if (stkData.ResponseCode !== '0') {
            const errorMsg = stkData.ResponseDescription || 'STK push failed';
            console.error('STK push failed:', errorMsg);
            return new Response(JSON.stringify({ error: errorMsg, details: stkData }), { status: 400 });
        }

        const checkoutRequestID = stkData.CheckoutRequestID;
        if (!checkoutRequestID) {
            throw new Error('No CheckoutRequestID returned');
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { error: updateError } = await supabase
            .from('sales')
            .update({
                mpesa_checkout_request_id: checkoutRequestID,
                payment_status: 'pending',
                payment_gateway: 'mpesa'
            })
            .eq('id', sale_id);

        if (updateError) {
            console.error('Failed to update sale:', updateError);
            return new Response(JSON.stringify({ error: 'Failed to record payment initiation', details: updateError.message }), { status: 500 });
        }

        // Log initiation (optional)
        const { error: logError } = await supabase.from('payment_transactions').insert({
            sale_id,
            gateway: 'mpesa',
            transaction_id: checkoutRequestID,
            request_payload: stkPushPayload,
            response_payload: stkData,
            status: 'initiated'
        });
        if (logError) {
            console.warn('Failed to log transaction:', logError);
        }

        return new Response(JSON.stringify({
            message: 'STK push sent',
            checkoutRequestID
        }), { status: 200 });

    } catch (error) {
        console.error('Operation failed:', error);
        return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
    }
});