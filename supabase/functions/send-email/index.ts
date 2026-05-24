import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'https://esm.sh/nodemailer@6.9.1'

async function generateReceiptHTML(transactionNumber: string, totalAmount: number, date: string, items: any[]): Promise<string> {
    const itemsHtml = items.map(item => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.product_name}</td>
            <td style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">${item.quantity}</td>
            <td style="padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">KES ${item.price.toFixed(2)}</td>
            <td style="padding: 8px; text-align: right; border-bottom: 1px solid #ddd;">KES ${(item.quantity * item.price).toFixed(2)}</td>
        </tr>
    `).join('')
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Receipt - VendGrid</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .header { text-align: center; border-bottom: 2px solid #007bff; padding-bottom: 15px; margin-bottom: 20px; }
                .logo { font-size: 24px; font-weight: bold; color: #007bff; }
                .receipt-title { font-size: 20px; font-weight: bold; margin: 20px 0; text-align: center; }
                table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                th { background: #f8f9fa; padding: 10px; text-align: left; border-bottom: 2px solid #dee2e6; }
                .total-row { font-size: 18px; font-weight: bold; text-align: right; margin-top: 15px; padding-top: 10px; border-top: 2px solid #dee2e6; }
                .footer { text-align: center; margin-top: 30px; padding-top: 15px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">VendGrid</div>
                    <p>Official Receipt</p>
                </div>
                <div class="receipt-title">Receipt #${transactionNumber}</div>
                <p><strong>Date:</strong> ${date}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Qty</th>
                            <th>Price</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                </table>
                <div class="total-row">
                    Total Amount: KES ${totalAmount.toFixed(2)}
                </div>
                <div class="footer">
                    <p>Thank you for shopping with us!</p>
                    <p>This is a computer-generated receipt. No signature required.</p>
                </div>
            </div>
        </body>
        </html>
    `
}

Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
        }
        
        const { to, subject, html, sale_id, transaction_number, total_amount, type } = await req.json()
        
        // Get SMTP settings from environment
        const smtpHost = Deno.env.get('SMTP_HOST')
        const smtpPort = parseInt(Deno.env.get('SMTP_PORT') || '587')
        const smtpUser = Deno.env.get('SMTP_USER')
        const smtpPass = Deno.env.get('SMTP_PASS')
        const smtpFrom = Deno.env.get('SMTP_FROM') || 'noreply@vendgrid.com'
        
        if (!smtpHost || !smtpUser || !smtpPass) {
            return new Response(JSON.stringify({ 
                error: 'Email service not configured. Please contact administrator.' 
            }), { status: 500 })
        }
        
        let emailHtml = html
        let emailTo = to
        let emailSubject = subject
        
        // If this is a receipt from sale_id, fetch data from database
        if (sale_id && type === 'receipt') {
            const supabase = createClient(
                Deno.env.get('SUPABASE_URL')!,
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
            )
            
            // Fetch sale items
            const { data: saleItems, error: itemsError } = await supabase
                .from('sale_items')
                .select('product_id, quantity, unit_price, total_price')
                .eq('sale_id', sale_id)
            
            if (itemsError) {
                throw new Error('Failed to fetch sale items')
            }
            
            // Fetch product names
            const productIds = saleItems.map(item => item.product_id)
            const { data: products, error: productsError } = await supabase
                .from('products')
                .select('id, name')
                .in('id', productIds)
            
            if (productsError) {
                throw new Error('Failed to fetch product details')
            }
            
            const productMap = new Map()
            products.forEach(p => productMap.set(p.id, p.name))
            
            const items = saleItems.map(item => ({
                product_name: productMap.get(item.product_id) || 'Unknown Product',
                quantity: item.quantity,
                price: item.unit_price,
                total: item.total_price
            }))
            
            const date = new Date().toLocaleString('en-KE')
            emailHtml = await generateReceiptHTML(transaction_number, total_amount, date, items)
            emailSubject = `Your Receipt from VendGrid - ${transaction_number}`
        }
        
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
        })
        
        await transporter.sendMail({
            from: `"VendGrid" <${smtpFrom}>`,
            to: emailTo,
            subject: emailSubject,
            html: emailHtml,
        })
        
        return new Response(JSON.stringify({ 
            success: true, 
            message: 'Email sent successfully' 
        }), { status: 200 })
        
    } catch (error: unknown) {
        console.error('Email error:', error)
        const message = error instanceof Error ? error.message : String(error)
        return new Response(JSON.stringify({ 
            error: message || 'Failed to send email' 
        }), { status: 500 })
    }
})