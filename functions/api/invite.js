export async function onRequestPost(context) {
  const { request, env } = context;

  const { email, inviteUrl, orgName } = await request.json();
  if (!email || !inviteUrl || !orgName) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'TranslateScorm <support@translatescorm.com>',
      to: [email],
      subject: `Zaproszenie do organizacji ${orgName} w TranslateScorm`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <h2 style="color:#1a1a1a;">Zaproszenie do zespołu</h2>
          <p>Zostałeś zaproszony do organizacji <strong>${orgName}</strong> w TranslateScorm.</p>
          <p>
            <a href="${inviteUrl}" style="display:inline-block;background:#4CDE80;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
              Dołącz do organizacji &rarr;
            </a>
          </p>
          <p style="color:#666;font-size:13px;">Link wygasa po 7 dniach.</p>
        </div>
      `
    })
  });

  if (!resendResp.ok) {
    const err = await resendResp.text();
    return Response.json({ error: err }, { status: 500 });
  }

  return Response.json({ success: true });
}
