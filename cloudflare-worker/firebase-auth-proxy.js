export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Only POST is supported' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const apiKey = body.api_key;
    if (!apiKey) {
      return json({ error: 'api_key is required' }, 400);
    }

    try {
      if (url.pathname === '/login') {
        const response = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: firebaseHeaders('application/json'),
            body: JSON.stringify({
              email: body.email,
              password: body.password,
              returnSecureToken: true
            })
          }
        );

        return forwardJson(response);
      }

      const form = new URLSearchParams();
      form.set('grant_type', body.grant_type || 'refresh_token');
      form.set('refresh_token', body.refresh_token || '');

      const response = await fetch(
        `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: firebaseHeaders('application/x-www-form-urlencoded'),
          body: form.toString()
        }
      );

      return forwardJson(response);
    } catch (error) {
      return json({ error: error.message || 'Proxy request failed' }, 502);
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function firebaseHeaders(contentType) {
  return {
    'Content-Type': contentType,
    Origin: 'https://windsurf.com',
    Referer: 'https://windsurf.com/'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders()
    }
  });
}

async function forwardJson(response) {
  const responseText = await response.text();

  return new Response(responseText, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      ...corsHeaders()
    }
  });
}