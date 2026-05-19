import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailerService {
  private resend: Resend | null = null;
  private fromEmail: string;
  private logger = new Logger(MailerService.name);

  constructor(private configService: ConfigService) {
    // Read directly from process.env as primary source — ConfigService may not
    // reflect Railway-injected vars when the .env file path resolves to missing.
    const apiKey =
      process.env['RESEND_API_KEY'] ??
      this.configService.get<string>('RESEND_API_KEY');

    this.fromEmail =
      process.env['SMTP_FROM_EMAIL'] ??
      this.configService.get<string>('SMTP_FROM_EMAIL', 'support@zuvelio.org');

    this.logger.log(
      `Mailer init — RESEND_API_KEY present: ${!!apiKey}, from: ${this.fromEmail}`,
    );

    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log('Resend email service ready.');
    } else {
      this.logger.error('RESEND_API_KEY is not set — add it to Railway variables.');
    }
  }

  private getResend(): Resend {
    if (!this.resend) {
      throw new Error('Email service not configured. RESEND_API_KEY environment variable is missing.');
    }
    return this.resend;
  }

  async sendPasswordResetEmail(email: string, name: string, resetToken: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    const { error } = await this.getResend().emails.send({
      from: this.fromEmail,
      to: email,
      subject: 'Reset Your Password - Zuvelio',
      html: this.getPasswordResetTemplate(name, resetLink),
    });

    if (error) {
      this.logger.error(`Failed to send password reset email to ${email}: ${error.message}`);
      throw new Error(error.message);
    }

    this.logger.log(`Password reset email sent to ${email}`);
  }

  async sendOtpEmail(email: string, name: string, otp: string): Promise<void> {
    const { error } = await this.getResend().emails.send({
      from: this.fromEmail,
      to: email,
      subject: 'Your Sign-In Verification Code - Zuvelio',
      html: this.getOtpTemplate(name, otp),
    });

    if (error) {
      this.logger.error(`Failed to send OTP email to ${email}: ${error.message}`);
      throw new Error(error.message);
    }

    this.logger.log(`OTP email sent to ${email}`);
  }

  private getOtpTemplate(name: string, otp: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Your Verification Code</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #cf9a43; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
            .otp-box { background-color: #ffffff; border: 2px solid #cf9a43; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
            .otp-code { font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #cf9a43; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>Sign-In Verification</h1></div>
            <div class="content">
              <p>Hi ${name},</p>
              <p>Use the code below to complete your sign-in. This code expires in <strong>10 minutes</strong>.</p>
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
              </div>
              <p>If you did not attempt to sign in, please ignore this email and consider changing your password.</p>
              <p><strong>Never share this code with anyone.</strong></p>
            </div>
            <div class="footer"><p>&copy; 2026 Zuvelio. All rights reserved.</p></div>
          </div>
        </body>
      </html>
    `;
  }

  private getPasswordResetTemplate(name: string, resetLink: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Reset Your Password</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #cf9a43; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
            .button { display: inline-block; padding: 10px 20px; background-color: #cf9a43; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>Password Reset Request</h1></div>
            <div class="content">
              <p>Hi ${name},</p>
              <p>We received a request to reset your password. Click the button below to reset your password. This link will expire in 30 minutes.</p>
              <a href="${resetLink}" class="button">Reset Password</a>
              <p>If you didn't request a password reset, you can safely ignore this email.</p>
              <p>Or copy and paste this link in your browser:</p>
              <p><small>${resetLink}</small></p>
            </div>
            <div class="footer"><p>&copy; 2026 Zuvelio. All rights reserved.</p></div>
          </div>
        </body>
      </html>
    `;
  }
}
