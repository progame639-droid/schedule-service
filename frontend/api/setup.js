const https = require('https');

module.exports = async function setup(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!process.env.SETUP_SECRET || req.query.secret !== process.env.SETUP_SECRET) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const token = process.env.BOT_TOKEN;
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!token || !webhookUrl) {
    return res.status(500).json({ ok: false, error: 'BOT_TOKEN or WEBHOOK_URL is missing' });
  }

  const url = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
  https.get(url, response => {
    let body = '';
    response.on('data', chunk => body += chunk);
    response.on('end', () => res.status(200).send(body));
  }).on('error', error => res.status(500).json({ ok: false, error: error.message }));
};
