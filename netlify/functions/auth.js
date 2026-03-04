const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const { action, email, password, token } = JSON.parse(event.body || '{}');

  let url, body;

  if (action === 'login') {
    url = SB_URL + '/auth/v1/token?grant_type=password';
    body = JSON.stringify({ email, password });
  } else if (action === 'logout') {
    url = SB_URL + '/auth/v1/logout';
    body = JSON.stringify({});
  } else if (action === 'me') {
    url = SB_URL + '/auth/v1/user';
    body = null;
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  }

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + (token || SB_KEY),
  };

  try {
    const res = await fetch(url, { method: body !== null ? 'POST' : 'GET', headers, body });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: text,
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
