import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
        }
        
        const { to, message, sale_id, transaction_number, total_amount, type } = await req.json()
        
        // Get SMS provider settings
        const smsProvider = Deno.env.get('SMS_PROVIDER') || 'africastalking'
        
        let smsTo = to
        let smsMessage = message
        
        // If this is a receipt from sale_id, build message
        if (sale_id && type === 'receipt') {
            // Fetch customer phone from sale or use provided
            smsMessage = `VendGrid Receipt #${transaction_number} - Total: KES ${total_amount.toFixed(2)}. Thank you for your purchase!`
        }
        
        if (!smsTo || !smsMessage) {
            return new Response(JSON.stringify({ 
                error: 'Missing required fields: to, message' 
            }), { status: 400 })
        }
        
        if (smsProvider === 'africastalking') {
            const apiKey = Deno.env.get('AFRICASTALKING_API_KEY')
            const username = Deno.env.get('AFRICASTALKING_USERNAME')
            const from = Deno.env.get('SMS_FROM') || 'VendGrid'
            
            if (!apiKey || !username) {
                return new Response(JSON.stringify({ 
                    error: 'SMS service not configured. Please contact administrator.' 
                }), { status: 500 })
            }
            
            // Clean phone number
            let cleanPhone = smsTo.replace(/\D/g, '')
            if (cleanPhone.startsWith('0')) {
                cleanPhone = '254' + cleanPhone.substring(1)
            }
            if (!cleanPhone.startsWith('254')) {
                cleanPhone = '254' + cleanPhone
            }
            
            const response = await fetch('https://api.africastalking.com/version1/messaging', {
                method: 'POST',
                headers: {
                    'ApiKey': apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: new URLSearchParams({
                    username: username,
                    to: cleanPhone,
                    from: from,
                    message: smsMessage,
                })
            })
            
            const result = await response.json()
            
            if (result.SMSMessageData?.Recipients?.[0]?.status === 'Success') {
                return new Response(JSON.stringify({ 
                    success: true, 
                    message: 'SMS sent successfully',
                    recipient: result.SMSMessageData.Recipients[0].number
                }), { status: 200 })
            } else {
                throw new Error(result.SMSMessageData?.Recipients?.[0]?.status || 'SMS sending failed')
            }
        }
        
        // Fallback: log SMS (for testing without actual SMS provider)
        console.log(`[SMS SIMULATION] To: ${smsTo}, Message: ${smsMessage}`)
        
        return new Response(JSON.stringify({ 
            success: true, 
            message: 'SMS sent (simulated)',
            simulated: true
        }), { status: 200 })
        
    } catch (unknownError) {
        console.error('SMS error:', unknownError)
        const message = unknownError instanceof Error ? unknownError.message : String(unknownError)
        return new Response(JSON.stringify({ 
            error: message || 'Failed to send SMS' 
        }), { status: 500 })
    }
})