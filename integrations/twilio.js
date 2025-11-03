const twilio = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendSMS(phone, message) {
  return await twilio.messages.create({
    body: message,
    to: phone,
    from: process.env.TWILIO_PHONE_NUMBER
  });
}

async function sendPassConfirmation(phone, venue, pass) {
  const backendUrl = process.env.BACKEND_URL || 'https://lightning-backend-production.up.railway.app';
  const qrImageUrl = `${backendUrl}/api/v1/lightning/passes/${pass.passId}/qr-image`;

  let message = `⚡ Your Lightning Pass is ready for ${venue.name}!\n\nPass ID: ${pass.passId}\nPasses: ${pass.quantity}\n\nAmount: $${pass.amount.toFixed(2)}\nValid until: ${new Date(pass.validUntil).toLocaleDateString()}`;

  if (pass.passName) {
    message += `\nType: ${pass.passName}`;
  }

  if (venue.tonightTagline) {
    message += `\n\n${venue.tonightTagline}`;
  }

  message += '\n\nShow this QR code at the door! 👇';

  // Send MMS with QR code image
  return await twilio.messages.create({
    body: message,
    to: phone,
    from: process.env.TWILIO_PHONE_NUMBER,
    mediaUrl: [qrImageUrl] // Twilio will fetch and attach the QR code image
  });
}

async function sendWaitTimeUpdate(phone, venueName, newTime) {
  const message = `⚡ ${venueName} wait time updated: ${newTime} minutes!`;
  return await sendSMS(phone, message);
}

async function sendRefundApproved(phone, venueName, passId, amount) {
  const message = `✅ Your refund request for ${venueName} has been APPROVED!\n\nPass ID: ${passId}\nRefund Amount: $${amount.toFixed(2)}\n\nYour refund will appear in 5-10 business days.`;
  return await sendSMS(phone, message);
}

async function sendRefundDenied(phone, venueName, passId, reason) {
  const message = `❌ Your refund request for ${venueName} has been denied.\n\nPass ID: ${passId}\nReason: ${reason}\n\nPlease contact the venue if you have questions.`;
  return await sendSMS(phone, message);
}

async function sendRefundIssued(phone, venueName, passId, amount) {
  const message = `💸 A refund has been issued for your ${venueName} pass!\n\nPass ID: ${passId}\nRefund Amount: $${amount.toFixed(2)}\n\nYour refund will appear in 5-10 business days.`;
  return await sendSMS(phone, message);
}

module.exports = {
  sendSMS,
  sendPassConfirmation,
  sendWaitTimeUpdate,
  sendRefundApproved,
  sendRefundDenied,
  sendRefundIssued
};
