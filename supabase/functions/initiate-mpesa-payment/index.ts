// ============================================================================
// initiate-mpesa-payment – Supabase Edge Function (Deno)
// Calls Safaricom STK Push API, stores CheckoutRequestID, logs transaction.
// ============================================================================

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
const MPESA_CALLBACK_URL = Deno.env.get('MPESA_CALLBACK_URL') || `${SUPABASE_URL}/functions/v1/mpesa-webhook`;

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
        const error = await res.text();
        throw new Error(`Failed to get access token: ${error}`);
    }
    const data = await res.json();
    return data.access_token;
}

// Helper: format phone number to 254XXXXXXXXX
function formatPhoneNumber(raw: string): string {
    let cleaned = raw.replace(/[^0-9]/g, '');
    if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
    if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
    return cleaned;
}

serve(async (req: Request) => {
    try {
        // Only accept POST
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
        }

        const { sale_id, phone_number, amount, transaction_number } = await req.json();

        if (!sale_id || !phone_number || !amount || !transaction_number) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
        }

        const formattedPhone = formatPhoneNumber(phone_number);
        const accessToken = await getAccessToken();

        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const password = btoa(MPESA_SHORTCODE + MPESA_PASSKEY + timestamp);

        const stkPushPayload = {
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

        const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(stkPushPayload)
        });

        const stkData = await stkRes.json();

        if (stkData.ResponseCode !== '0') {
            throw new Error(stkData.ResponseDescription || 'STK push failed');
        }

        const checkoutRequestID = stkData.CheckoutRequestID;

        // Update sale with checkout request ID and pending status
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { error: updateError } = await supabase
            .from('sales')
            .update({
                mpesa_checkout_request_id: checkoutRequestID,
                payment_status: 'pending',
                payment_gateway: 'mpesa'
            })
            .eq('id', sale_id);

        if (updateError) throw updateError;

        // Log initiation
        await supabase.from('payment_transactions').insert({
            sale_id,
            gateway: 'mpesa',
            transaction_id: checkoutRequestID,
            request_payload: stkPushPayload,
            response_payload: stkData,
            status: 'initiated'
        });

        return new Response(JSON.stringify({
            message: 'STK push sent',
            checkoutRequestID
        }), { status: 200 });
 } catch (error) {
  console.error('Operation failed:', error);
  return new Response(JSON.stringify({ error: (error as any).message }), { status: 500 });
}
});