// ============================================================================
// mpesa-webhook – Receives M-Pesa callback, verifies payment, updates sale,
// deducts inventory, logs transaction.
// ============================================================================

/// <reference lib="deno.ns" />
/// <reference lib="deno.unstable" />

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface STKCallback {
    CheckoutRequestID: string;
    ResultCode: string;
    ResultDesc: string;
    CallbackMetadata?: {
        Item: Array<{ Name: string; Value: any }>;
    };
}

interface MpesaCallbackBody {
    Body?: {
        stkCallback: STKCallback;
    };
}

serve(async (req: Request) => {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const callback = await req.json() as MpesaCallbackBody;
        console.log('Webhook received:', JSON.stringify(callback, null, 2));

        const { Body } = callback;
        if (!Body || !Body.stkCallback) {
            console.log('Ignored non-STK callback');
            return new Response(JSON.stringify({ message: 'Ignored' }), { status: 200 });
        }

        const stkCallback = Body.stkCallback;
        const checkoutRequestID = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;
        const resultDesc = stkCallback.ResultDesc;

        console.log(`Processing callback for CheckoutRequestID: ${checkoutRequestID}, ResultCode: ${resultCode}`);

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Find the sale
        const { data: sale, error: findError } = await supabase
            .from('sales')
            .select('id, transaction_number, payment_status')
            .eq('mpesa_checkout_request_id', checkoutRequestID)
            .single();

        if (findError || !sale) {
            console.error('Sale not found for checkoutRequestID:', checkoutRequestID);
            return new Response(JSON.stringify({ error: 'Sale not found' }), { status: 404 });
        }

        // Idempotency: skip if already processed
        if (sale.payment_status === 'completed' || sale.payment_status === 'failed') {
            console.log(`Sale ${sale.id} already ${sale.payment_status}, skipping duplicate callback`);
            return new Response(JSON.stringify({ message: 'Already processed' }), { status: 200 });
        }

        if (resultCode === '0') {
            // Payment successful
            const metadata = stkCallback.CallbackMetadata?.Item || [];
            const mpesaReceipt = metadata.find((i: any) => i.Name === 'MpesaReceiptNumber')?.Value;
            const amount = metadata.find((i: any) => i.Name === 'Amount')?.Value;
            const transactionDate = metadata.find((i: any) => i.Name === 'TransactionDate')?.Value;

            console.log(`Payment successful for sale ${sale.id}, receipt: ${mpesaReceipt}`);

            const { error: confirmError } = await supabase.rpc('confirm_payment', {
                p_sale_id: sale.id,
                p_payment_reference: mpesaReceipt,
                p_gateway: 'mpesa',
                p_mpesa_result_code: resultCode,
                p_mpesa_result_desc: resultDesc
            });

            if (confirmError) {
                console.error('confirm_payment error:', confirmError);
                await supabase.from('payment_transactions').insert({
                    sale_id: sale.id,
                    gateway: 'mpesa',
                    transaction_id: mpesaReceipt,
                    response_payload: callback,
                    status: 'failed',
                    error_message: confirmError.message
                });
                return new Response(JSON.stringify({ error: 'Failed to confirm payment' }), { status: 500 });
            }

            await supabase.from('payment_transactions').insert({
                sale_id: sale.id,
                gateway: 'mpesa',
                transaction_id: mpesaReceipt,
                response_payload: callback,
                status: 'completed'
            });

            console.log(`Payment completed for sale ${sale.id}, receipt ${mpesaReceipt}`);
        } else {
            // Payment failed
            console.error(`Payment failed for sale ${sale.id}: ${resultDesc}`);

            await supabase
                .from('sales')
                .update({
                    payment_status: 'failed',
                    mpesa_result_code: resultCode,
                    mpesa_result_desc: resultDesc,
                    updated_at: new Date().toISOString()
                })
                .eq('id', sale.id);

            await supabase.from('payment_transactions').insert({
                sale_id: sale.id,
                gateway: 'mpesa',
                response_payload: callback,
                status: 'failed'
            });
        }

        return new Response(JSON.stringify({ message: 'Webhook processed' }), { status: 200 });
    } catch (error) {
        console.error('Webhook error:', error);
        return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
    }
});