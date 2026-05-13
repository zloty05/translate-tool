export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });

  const userResp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY }
  });
  if (!userResp.ok) return Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });

  const body = await request.json();
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json();
  return Response.json(data, { status: resp.status });
}
