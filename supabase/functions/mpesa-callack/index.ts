import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
    try {
        // Only allow POST requests
        if (req.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 })
        }
        
        const callbackData = await req.json()
        
        console.log('M-Pesa Callback Received:', JSON.stringify(callbackData, null, 2))
        
        // Extract callback details
        const stkCallback = callbackData.Body?.stkCallback
        
        if (!stkCallback) {
            return new Response('Invalid callback data', { status: 400 })
        }
        
        const merchantRequestId = stkCallback.MerchantRequestID
        const checkoutRequestId = stkCallback.CheckoutRequestID
        const resultCode = stkCallback.ResultCode
        const resultDesc = stkCallback.ResultDesc
        
        // Find the sale by merchant request ID
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )
        
        const { data: sale, error: findError } = await supabase
            .from('sales')
            .select('id, transaction_number, total_amount, cashier_id')
            .eq('payment_reference', merchantRequestId)
            .single()
        
        if (findError || !sale) {
            console.error('Sale not found for merchant request:', merchantRequestId)
            return new Response('Sale not found', { status: 404 })
        }
        
        let paymentStatus = 'failed'
        let paymentReference = null
        
        if (resultCode === '0') {
            // Payment successful
            paymentStatus = 'completed'
            
            // Extract payment reference from callback
            const callbackMetadata = stkCallback.CallbackMetadata
            if (callbackMetadata && callbackMetadata.Item) {
                const mpesaReceipt = callbackMetadata.Item.find((item: any) => item.Name === 'MpesaReceiptNumber')
                if (mpesaReceipt) {
                    paymentReference = mpesaReceipt.Value
                }
            }
            
            // Update sale as completed
            await supabase
                .from('sales')
                .update({ 
                    payment_status: paymentStatus,
                    payment_reference: paymentReference || merchantRequestId,
                    updated_at: new Date().toISOString()
                })
                .eq('id', sale.id)
            
            // Send email receipt
            const { error: emailError } = await supabase.functions.invoke('send-email', {
                body: {
                    sale_id: sale.id,
                    transaction_number: sale.transaction_number,
                    total_amount: sale.total_amount,
                    type: 'receipt'
                }
            })
            
            if (emailError) {
                console.error('Failed to send email receipt:', emailError)
            }
            
            // Send SMS receipt
            const { error: smsError } = await supabase.functions.invoke('send-sms', {
                body: {
                    sale_id: sale.id,
                    transaction_number: sale.transaction_number,
                    total_amount: sale.total_amount,
                    type: 'receipt'
                }
            })
            
            if (smsError) {
                console.error('Failed to send SMS receipt:', smsError)
            }
            
        } else {
            // Payment failed
            await supabase
                .from('sales')
                .update({ 
                    payment_status: 'failed',
                    payment_reference: merchantRequestId,
                    updated_at: new Date().toISOString()
                })
                .eq('id', sale.id)
        }
        
        return new Response(JSON.stringify({ 
            success: true, 
            resultCode: resultCode,
            resultDesc: resultDesc 
        }), { status: 200 })
        
    } catch (error) {
        console.error('Callback error:', error)
        return new Response('Internal error', { status: 500 })
    }
})