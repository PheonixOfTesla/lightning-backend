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
  let message = `⚡ Your Lightning Pass is ready for ${venue.name}!\n\nPass ID: ${pass.passId}\nPasses: ${pass.quantity}\nShow QR code at door!`;
  
  if (venue.tonightTagline) {
    message += `\n\n${venue.tonightTagline}`;
  }
  
  return await sendSMS(phone, message);
}

async function sendWaitTimeUpdate(phone, venueName, newTime) {
  const message = `⚡ ${venueName} wait time updated: ${newTime} minutes!`;
  return await sendSMS(phone, message);
}

module.exports = { sendSMS, sendPassConfirmation, sendWaitTimeUpdate };
