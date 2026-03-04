const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const userToken = event.headers['x-user-token'];
  if (!userToken) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const filename = event.queryStringParameters?.filename || ('file_' + Date.now());
  const contentType = event.headers['x-file-type'] || 'image/gif';
  const buffer = Buffer.from(event.body, 'base64');

  try {
    const res = await fetch(SB_URL + '/storage/v1/object/media/' + filename, {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + userToken,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: buffer,
    });
    const publicUrl = SB_URL + '/storage/v1/object/public/media/' + filename;
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ url: publicUrl }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
