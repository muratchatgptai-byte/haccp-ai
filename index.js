'use strict';

const http = require('http');

const PORT = Number(process.env.PORT || 3000);

const HACCP_BRIDGE_URL =
  process.env.HACCP_BRIDGE_URL || '';

const HACCP_BRIDGE_SECRET =
  process.env.HACCP_BRIDGE_SECRET || '';


// ============================================================
// BASIC JSON RESPONSE
// ============================================================

function sendJson(res, statusCode, obj) {

  const body = JSON.stringify(obj);

  res.writeHead(
    statusCode,
    {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    }
  );

  res.end(body);
}


// ============================================================
// READ BODY
// ============================================================

function readBody(req) {

  return new Promise((resolve, reject) => {

    let body = '';

    req.on('data', chunk => {

      body += chunk;

      if (body.length > 1024 * 1024) {

        reject(
          new Error('Request body too large')
        );

        req.destroy();
      }
    });

    req.on('end', () => {
      resolve(body);
    });

    req.on('error', reject);
  });
}


// ============================================================
// HACCP BRIDGE CALL
// ============================================================

async function callHaccpBridge(
  action,
  payload = {}
) {

  if (!HACCP_BRIDGE_URL) {
    throw new Error(
      'HACCP_BRIDGE_URL tanımlı değil'
    );
  }

  if (!HACCP_BRIDGE_SECRET) {
    throw new Error(
      'HACCP_BRIDGE_SECRET tanımlı değil'
    );
  }


  const response =
    await fetch(
      HACCP_BRIDGE_URL,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          secret:
            HACCP_BRIDGE_SECRET,

          action,

          ...payload
        })
      }
    );


  const text =
    await response.text();


  let data;

  try {

    data =
      JSON.parse(text);

  } catch {

    throw new Error(
      'Bridge JSON dönmedi: ' +
      text.slice(0, 300)
    );
  }


  return data;
}


// ============================================================
// SERVER
// ============================================================

const server =
  http.createServer(
    async (req, res) => {

      try {

        const url =
          new URL(
            req.url,
            `http://${req.headers.host || 'localhost'}`
          );


        // ----------------------------------------------------
        // HEALTH
        // ----------------------------------------------------

        if (
          req.method === 'GET' &&
          url.pathname === '/health'
        ) {

          return sendJson(
            res,
            200,
            {
              ok: true,
              service: 'haccp-ai',
              version: '1.0.0'
            }
          );
        }


        // ----------------------------------------------------
        // BRIDGE HEALTH TEST
        // ----------------------------------------------------

        if (
          req.method === 'GET' &&
          url.pathname === '/bridge-health'
        ) {

          const result =
            await callHaccpBridge(
              'health_check'
            );


          return sendJson(
            res,
            result.ok ? 200 : 500,
            {
              ok:
                Boolean(result.ok),

              bridge:
                result
            }
          );
        }


        // ----------------------------------------------------
        // TEST POST
        // ----------------------------------------------------

        if (
          req.method === 'POST' &&
          url.pathname === '/test'
        ) {

          const bodyText =
            await readBody(req);


          let body = {};

          if (bodyText) {

            try {
              body =
                JSON.parse(bodyText);
            } catch {
              return sendJson(
                res,
                400,
                {
                  ok: false,
                  error:
                    'Geçersiz JSON'
                }
              );
            }
          }


          return sendJson(
            res,
            200,
            {
              ok: true,
              received: body
            }
          );
        }


        // ----------------------------------------------------
        // 404
        // ----------------------------------------------------

        return sendJson(
          res,
          404,
          {
            ok: false,
            error: 'Not found'
          }
        );


      } catch (err) {

        console.error(err);

        return sendJson(
          res,
          500,
          {
            ok: false,
            error:
              err &&
              err.message
                ? err.message
                : String(err)
          }
        );
      }
    }
  );


// ============================================================
// START
// ============================================================

server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `HACCP AI listening on port ${PORT}`
    );
  }
);
