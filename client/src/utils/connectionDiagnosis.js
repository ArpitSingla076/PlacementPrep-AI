/**
 * Turns the results of three probes into a plain-language verdict.
 *   direct : GET <server>/health the normal way (needs the server's CORS permission to be readable)
 *   noCors : the same request in "no-cors" mode: succeeds if ANY reply arrives, even without CORS permission
 *   proxy  : GET /api/health on THIS website, which Vercel forwards to the server ("same-site mode"); needs no CORS at all
 * Each probe: { reached, status?, json?, ms?, timeout?, opaque? }
 */
const isJsonOk = (p) => !!p?.reached && p.json?.success === true && p.json?.data?.status === 'ok';
const allows = (p, origin) => (p?.json?.data?.allowedOrigins ?? []).includes(origin);

const label = (name, p, okText, failText) => ({ name, state: !p ? 'skip' : p.reached ? 'ok' : 'fail', detail: !p ? 'not applicable' : p.reached ? okText(p) : failText });

export function diagnoseConnection({ origin, api, direct, noCors, proxy }) {
  const usingDirect = /^https?:\/\//.test(api);
  const checks = [
    usingDirect ? label('Direct connection to the server', direct, (p) => (p.json ? 'HTTP ' + p.status + ', readable' : 'HTTP ' + p.status + ', not this app'), 'no readable reply (blocked, asleep, or missing CORS permission)') : { name: 'Direct connection to the server', state: 'skip', detail: 'not used: this site forwards /api itself' },
    usingDirect ? label('Server reachable at all (ignoring permissions)', noCors, () => 'a reply arrived', 'nothing arrived: the connection itself fails') : { name: 'Server reachable at all', state: 'skip', detail: 'not applicable' },
    label('Same-site connection through this website', proxy, (p) => (p.json ? 'HTTP ' + p.status + ', readable' : 'HTTP ' + p.status + ', not this app'), 'no readable reply'),
  ];
  const result = (tone, title, tips) => ({ tone, title, tips, checks });
  const proxyOk = isJsonOk(proxy) && allows(proxy, origin);
  const directOk = usingDirect && isJsonOk(direct) && allows(direct, origin);
  const switchTips = ['In Vercel > Settings > Environment Variables, delete VITE_API_URL, then click Redeploy. The site will then use the working same-site connection.', 'In Render, set TRUST_PROXY_HOPS=2 so rate limits see real visitors.'];

  if (usingDirect ? directOk : proxyOk) {
    return result('ok', 'Everything is connected', ['The server answered and allows this website. You can sign in or register now.', ...(usingDirect && proxyOk ? ['The same-site connection works too (an alternative if you ever see CORS problems).'] : [])]);
  }

  if (usingDirect && proxyOk) {
    return result('warn', 'The direct connection fails, but the same-site connection works',
      [noCors?.reached
        ? 'The server is reachable from your browser, but its replies are not accepted by the browser (the CORS permission is missing or the reply comes from the hosting platform, not the app).'
        : 'Your browser cannot connect to the server directly (a network, firewall, antivirus or browser setting may block it).',
      ...switchTips]);
  }

  const server = usingDirect ? direct : proxy;
  if (server?.reached && !server.json?.data) {
    return result('bad', 'Something answered (HTTP ' + server.status + ') but it is not this app\'s server', ['The service may not be running (the hosting platform shows its own page), or the address is wrong.', usingDirect ? 'Server address in use: ' + api : 'Check the destination in client/vercel.json.', 'Open the hosting dashboard: the service should say Live, and its Logs should show "listening".']);
  }
  if (server?.reached && server.json?.data?.status !== 'ok') {
    return result('warn', 'The server is running but cannot reach its database', ['Check the database connection string, and that the database allows connections from the server (Atlas > Network Access).']);
  }
  if (server?.reached && !allows(server, origin)) {
    return result('bad', 'The server is running, but it does not allow this website', ['This website is ' + origin + '.', 'The server allows: ' + ((server.json.data.allowedOrigins ?? []).join(', ') || 'nothing') + '.', 'In Render, set CLIENT_URL to ' + origin + ' and wait for the redeploy.']);
  }

  if (usingDirect && noCors?.reached) {
    return result('bad', 'The server is reachable, but its replies are not readable by this website', ['The reply arrives without the CORS permission header, so the browser hides it. That means the reply is not coming from the app (for example a hosting error page), or the app does not allow this website.', 'In Render > Logs, press "Check again" here and look for a new line. If a request line with origin=' + origin + ' appears, the app received it. If a "[cors] blocked" line appears, fix CLIENT_URL. If nothing appears, the request never reaches the app.', 'Switch to same-site mode (see the tips under the green result) to avoid CORS completely.']);
  }
  return result('bad', 'This browser cannot reach the server at all', ['Nothing arrives, even ignoring permissions. Likely causes: the server is asleep (press "Keep trying" and wait a minute), the service is not running (check Render), or your network, firewall, antivirus or browser blocks it.', 'Test the same page on your phone using mobile data (not Wi-Fi). If it works there, the problem is your network or device, not the deployment.', 'Earlier this project also had trouble on one Wi-Fi network: try a different network.']);
}
