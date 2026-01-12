/**
 * Email Notification Service
 * 
 * This Edge Function sends email notifications to users via SMTP.
 * It supports various email templates for different notification types.
 * 
 * Configuration:
 * - SMTP_HOST: SMTP server host
 * - SMTP_PORT: SMTP server port
 * - SMTP_USER: SMTP username
 * - SMTP_PASSWORD: SMTP password
 * - SMTP_FROM_EMAIL: Sender email address
 * - SMTP_FROM_NAME: Sender name
 * 
 * Note: Using denomailer for SMTP. For production, consider using established
 * email service providers' REST APIs (SendGrid, AWS SES, Mailgun) for better
 * reliability and deliverability tracking.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
};

interface EmailRequest {
  to: string;
  subject: string;
  type: 'contribution_paid' | 'payout_received' | 'penalty_applied' | 'member_joined' | 'group_status_change' | 'custom';
  data: Record<string, any>;
}

/**
 * Email templates
 */
const emailTemplates = {
  contribution_paid: (data: any) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #1e7d6e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #1e7d6e; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Payment Received</h1>
    </div>
    <div class="content">
      <p>Hello ${data.userName || 'Member'},</p>
      <p>Your contribution of <strong>₦${data.amount}</strong> for <strong>${data.groupName}</strong> has been received successfully.</p>
      <p><strong>Details:</strong></p>
      <ul>
        <li>Group: ${data.groupName}</li>
        <li>Cycle: ${data.cycleNumber}</li>
        <li>Amount: ₦${data.amount}</li>
        <li>Date: ${new Date(data.date).toLocaleString()}</li>
        <li>Reference: ${data.reference}</li>
      </ul>
      <p>Thank you for your timely contribution!</p>
      <a href="${data.appUrl}/groups/${data.groupId}" class="button">View Group</a>
    </div>
    <div class="footer">
      <p>Smart Ajo - Secure Savings Made Easy</p>
      <p>This is an automated message, please do not reply.</p>
    </div>
  </div>
</body>
</html>
`,

  payout_received: (data: any) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #1e7d6e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #1e7d6e; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
    .highlight { background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Payout Completed!</h1>
    </div>
    <div class="content">
      <p>Hello ${data.userName || 'Member'},</p>
      <div class="highlight">
        <p><strong>Great news!</strong> Your payout of <strong>₦${data.amount}</strong> has been processed successfully.</p>
      </div>
      <p><strong>Details:</strong></p>
      <ul>
        <li>Group: ${data.groupName}</li>
        <li>Cycle: ${data.cycleNumber}</li>
        <li>Amount: ₦${data.amount}</li>
        <li>Date: ${new Date(data.date).toLocaleString()}</li>
        <li>Reference: ${data.reference}</li>
      </ul>
      <p>The funds should reflect in your account shortly.</p>
      <a href="${data.appUrl}/dashboard" class="button">View Dashboard</a>
    </div>
    <div class="footer">
      <p>Smart Ajo - Secure Savings Made Easy</p>
      <p>This is an automated message, please do not reply.</p>
    </div>
  </div>
</body>
</html>
`,

  penalty_applied: (data: any) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #dc3545; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #1e7d6e; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
    .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Penalty Applied</h1>
    </div>
    <div class="content">
      <p>Hello ${data.userName || 'Member'},</p>
      <div class="warning">
        <p><strong>Important:</strong> A penalty of <strong>₦${data.amount}</strong> has been applied to your account.</p>
      </div>
      <p><strong>Details:</strong></p>
      <ul>
        <li>Group: ${data.groupName}</li>
        <li>Penalty Type: ${data.penaltyType}</li>
        <li>Amount: ₦${data.amount}</li>
        <li>Reason: ${data.reason}</li>
        <li>Date: ${new Date(data.date).toLocaleString()}</li>
      </ul>
      <p>To avoid future penalties, please ensure timely contributions.</p>
      <a href="${data.appUrl}/groups/${data.groupId}" class="button">View Group</a>
    </div>
    <div class="footer">
      <p>Smart Ajo - Secure Savings Made Easy</p>
      <p>This is an automated message, please do not reply.</p>
    </div>
  </div>
</body>
</html>
`,

  member_joined: (data: any) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #1e7d6e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #1e7d6e; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to ${data.groupName}!</h1>
    </div>
    <div class="content">
      <p>Hello ${data.userName || 'Member'},</p>
      <p>Welcome to <strong>${data.groupName}</strong>! You have successfully joined the group at position <strong>${data.position}</strong>.</p>
      <p><strong>Group Details:</strong></p>
      <ul>
        <li>Contribution Amount: ₦${data.contributionAmount}</li>
        <li>Frequency: ${data.frequency}</li>
        <li>Total Members: ${data.totalMembers}</li>
        <li>Your Position: ${data.position}</li>
      </ul>
      <p>Next steps:</p>
      <ol>
        <li>Pay your security deposit</li>
        <li>Wait for the group to fill up</li>
        <li>Start making contributions when the cycle begins</li>
      </ol>
      <a href="${data.appUrl}/groups/${data.groupId}" class="button">View Group</a>
    </div>
    <div class="footer">
      <p>Smart Ajo - Secure Savings Made Easy</p>
      <p>This is an automated message, please do not reply.</p>
    </div>
  </div>
</body>
</html>
`,

  group_status_change: (data: any) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #1e7d6e; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; padding: 12px 24px; background-color: #1e7d6e; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Group Status Update</h1>
    </div>
    <div class="content">
      <p>Hello ${data.userName || 'Member'},</p>
      <p>The status of <strong>${data.groupName}</strong> has been updated to: <strong>${data.newStatus}</strong></p>
      <p>${data.message}</p>
      <a href="${data.appUrl}/groups/${data.groupId}" class="button">View Group</a>
    </div>
    <div class="footer">
      <p>Smart Ajo - Secure Savings Made Easy</p>
      <p>This is an automated message, please do not reply.</p>
    </div>
  </div>
</body>
</html>
`,
};

/**
 * Send email via SMTP
 */
async function sendEmail(
  to: string,
  subject: string,
  htmlContent: string
): Promise<{ success: boolean; message: string }> {
  try {
    const smtpHost = Deno.env.get('SMTP_HOST');
    const smtpPort = parseInt(Deno.env.get('SMTP_PORT') || '587');
    const smtpUser = Deno.env.get('SMTP_USER');
    const smtpPassword = Deno.env.get('SMTP_PASSWORD');
    const fromEmail = Deno.env.get('SMTP_FROM_EMAIL');
    const fromName = Deno.env.get('SMTP_FROM_NAME') || 'Smart Ajo';

    if (!smtpHost || !smtpUser || !smtpPassword || !fromEmail) {
      return { success: false, message: 'SMTP configuration incomplete' };
    }

    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        tls: true,
        auth: {
          username: smtpUser,
          password: smtpPassword,
        },
      },
    });

    await client.send({
      from: `${fromName} <${fromEmail}>`,
      to: to,
      subject: subject,
      content: htmlContent,
      html: htmlContent,
    });

    await client.close();

    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    console.error('Email sending error:', error);
    return { success: false, message: `Failed to send email: ${error.message}` };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    // Verify request is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const emailRequest: EmailRequest = await req.json();

    // Validate request
    if (!emailRequest.to || !emailRequest.subject || !emailRequest.type) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Generate email content
    let htmlContent: string;
    
    if (emailRequest.type === 'custom') {
      htmlContent = emailRequest.data.html || emailRequest.data.message || '';
    } else {
      const template = emailTemplates[emailRequest.type];
      if (!template) {
        return new Response(
          JSON.stringify({ error: 'Invalid email type' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      htmlContent = template(emailRequest.data);
    }

    // Send email
    const result = await sendEmail(emailRequest.to, emailRequest.subject, htmlContent);

    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Email service error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
