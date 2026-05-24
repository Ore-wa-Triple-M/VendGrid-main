import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Daraja API endpoints
const DARAJA_BASE_URL = Deno.env.get('DARAJA_ENV') === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke'

// Helper to get OAuth token from Daraja
async function getAccessToken(consumerKey: string, consumerSecret: string): Promise<string> {
    const auth = btoa(`${consumerKey}:${consumerSecret}`)
    const response = await fetch(`${DARAJA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${auth}`
        }
    })
    
    const data = await response.json()
    if (!response.ok) {
        throw new Error(`Failed to get access token: ${data.errorMessage || 'Unknown error'}`)
    }
    return data.access_token
}

// Initiate STK Push
async function stkPush(accessToken: string, phoneNumber: string, amount: number, accountRef: string, transactionDesc: string) {
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
    const password = btoa(`${Deno.env.get('DARAJA_SHORTCODE')}${Deno.env.get('DARAJA_PASSKEY')}${timestamp}`)
    
    const response = await fetch(`${DARAJA_BASE_URL}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            BusinessShortCode: Deno.env.get('DARAJA_SHORTCODE'),
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: phoneNumber,
            PartyB: Deno.env.get('DARAJA_SHORTCODE'),
            PhoneNumber: phoneNumber,
            CallBackURL: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`,
            AccountReference: accountRef,
            TransactionDesc: transactionDesc
        })
    })
    
    return await response.json()
}

Deno.serve(async (req) => {
    try {
        // Only allow POST requests
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
        }
        
        const { sale_id, phone_number, amount, transaction_number } = await req.json()
        
        // Validation
        if (!sale_id || !phone_number || !amount || !transaction_number) {
            return new Response(JSON.stringify({ 
                error: 'Missing required fields: sale_id, phone_number, amount, transaction_number' 
            }), { status: 400 })
        }
        
        // Clean phone number (remove +, spaces, etc.)
        let cleanPhone = phone_number.replace(/\D/g, '')
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '254' + cleanPhone.substring(1)
        }
        if (!cleanPhone.startsWith('254')) {
            cleanPhone = '254' + cleanPhone
        }
        
        // Get Daraja credentials from environment
        const consumerKey = Deno.env.get('DARAJA_CONSUMER_KEY')
        const consumerSecret = Deno.env.get('DARAJA_CONSUMER_SECRET')
        
        if (!consumerKey || !consumerSecret) {
            throw new Error('M-Pesa credentials not configured')
        }
        
        // Get access token
        const accessToken = await getAccessToken(consumerKey, consumerSecret)
        
        // Initiate STK push
        const stkResult = await stkPush(accessToken, cleanPhone, amount, transaction_number, 'VendGrid Payment')
        
        if (stkResult.ResponseCode !== '0') {
            // Update sale as failed
            const supabase = createClient(
                Deno.env.get('SUPABASE_URL')!,
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
            )
            
            await supabase
                .from('sales')
                .update({ 
                    payment_status: 'failed',
                    payment_reference: stkResult.MerchantRequestID || null
                })
                .eq('id', sale_id)
            
            return new Response(JSON.stringify({
                success: false,
                error: stkResult.ResponseDescription || 'STK push failed',
                merchantRequestId: stkResult.MerchantRequestID
            }), { status: 400 })
        }
        
        // Update sale with merchant request ID
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )
        
        await supabase
            .from('sales')
            .update({ 
                payment_reference: stkResult.MerchantRequestID,
                payment_status: 'pending'
            })
            .eq('id', sale_id)
        
        return new Response(JSON.stringify({
            success: true,
            message: 'STK push sent successfully',
            merchantRequestId: stkResult.MerchantRequestID,
            checkoutRequestId: stkResult.CheckoutRequestID
        }), { status: 200 })
        
    } catch (error) {
        console.error('M-Pesa payment error:', error)
        const errorMessage = error instanceof Error ? error.message : 'Internal server error'
        return new Response(JSON.stringify({ 
            error: errorMessage
        }), { status: 500 })
    }
})