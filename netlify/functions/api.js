const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

exports.handler = async function(event) {
  const method = event.httpMethod;
  const body = event.body;
  const userToken = event.headers['x-user-token'] || null;
  const isMutation = ['POST', 'PATCH', 'DELETE'].includes(method);

  if (isMutation && !userToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const rawQuery = event.rawQuery || '';
  const pathMatch = rawQuery.match(/path=(.+)/);
  if (!pathMatch) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No path specified' }) };
  }
  const sbPath = decodeURIComponent(pathMatch[1]);

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + (userToken || SB_KEY),
  };
  if (event.headers['prefer']) headers['Prefer'] = event.headers['prefer'];

  try {
    const res = await fetch(SB_URL + sbPath, {
      method,
      headers,
      body: isMutation ? body : undefined,
    });
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
