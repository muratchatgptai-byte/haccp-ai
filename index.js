'use strict';

const http = require('http');

const PORT = Number(process.env.PORT || 3000);

const HACCP_BRIDGE_URL =
  process.env.HACCP_BRIDGE_URL || '';

const HACCP_BRIDGE_SECRET =
  process.env.HACCP_BRIDGE_SECRET || '';

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || '';

const OPENAI_MODEL =
  process.env.OPENAI_MODEL || 'gpt-6-sol';


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
// HACCP MESSAGE INTERPRETER
// ============================================================

function extractOpenAIText(response) {

  if (
    response &&
    typeof response.output_text === 'string' &&
    response.output_text.trim()
  ) {
    return response.output_text.trim();
  }


  const parts = [];

  for (const item of response?.output || []) {

    if (
      item?.type !== 'message' ||
      !Array.isArray(item.content)
    ) {
      continue;
    }

    for (const part of item.content) {

      if (
        part?.type === 'output_text' &&
        typeof part.text === 'string'
      ) {
        parts.push(part.text);
      }
    }
  }

  return parts.join('\n').trim();
}


function parseJsonText(text) {

  let cleaned =
    String(text || '').trim();

  if (cleaned.startsWith('```')) {

    cleaned =
      cleaned
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
  }

  return JSON.parse(cleaned);
}


async function interpretHaccpMessage(text) {

  if (!OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY tanımlı değil'
    );
  }


  const systemPrompt = `
Sen Boşnak Tatları HACCP sisteminin komut yorumlayıcısısın.

Görevin kullanıcının mesajını anlamak ve yapılandırılmış JSON üretmektir.

KESİNLİKLE kayıt oluşturma, değiştirme veya silme.
Sadece ne yapılmak istendiğini belirle.

Desteklenen intent değerleri:

get_batch
create_batch
record_process_measurement
record_ph
unknown

Yazma işlemleri:
create_batch
record_process_measurement
record_ph

Bu işlemlerde:
requires_confirmation = true

Sadece okuma işlemi olan get_batch için:
requires_confirmation = false

Eksik veya belirsiz bilgi varsa tahmin etme.
ready = false yap ve question alanında kısa bir soru üret.

Yanıt SADECE geçerli JSON olsun.

Format:

{
  "intent": "unknown",
  "ready": false,
  "requires_confirmation": false,
  "summary": "",
  "data": {},
  "question": null
}

create_batch için data:

{
  "product_type": "sour_cream | stp | dessert",
  "batch": {
    "batch_no": "",
    "date": "",
    "recipe": "",
    "product": "",
    "grammage": "",
    "unit": "",
    "quantity": "",
    "total_production": "",
    "invoice_info": "",
    "raw_material_lots": "",
    "batch_count": "",
    "output_kg": ""
  }
}

record_process_measurement için data:

{
  "batch_no": "",
  "process": "",
  "measurement": "",
  "time": "",
  "result": ""
}

record_ph için data:

{
  "batch_no": "",
  "ph": "",
  "time": ""
}

get_batch için data:

{
  "batch_no": ""
}

Kullanıcı bir mesajda birden fazla işlem söylüyorsa summary alanında bunu belirt,
ancak hiçbir işlemi kendin uygulama.
`.trim();


  const response =
    await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',

        headers: {
          Authorization:
            `Bearer ${OPENAI_API_KEY}`,

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          model:
            OPENAI_MODEL,

          input: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content:
                String(text || '')
            }
          ],

          reasoning: {
            effort: 'medium'
          },

          max_output_tokens: 1200
        })
      }
    );


  const body =
    await response.json();


  if (!response.ok) {

    throw new Error(
      body?.error?.message ||
      `OpenAI HTTP ${response.status}`
    );
  }


  const outputText =
    extractOpenAIText(body);


  if (!outputText) {
    throw new Error(
      'OpenAI boş yorum döndürdü'
    );
  }


  return parseJsonText(
    outputText
  );
}


// ============================================================
// HACCP CONFIRMATION FLOW
// ============================================================

const pendingConfirmations =
  new Map();


function normalizeCommandText(text) {

  return String(text || '')
    .trim()
    .toLocaleLowerCase('tr-TR');
}


function isConfirmationYes(text) {

  const value =
    normalizeCommandText(text);

  return [
    'evet',
    'onay',
    'onayla',
    'tamam',
    'kaydet',
    'yes'
  ].includes(value);
}


function isConfirmationNo(text) {

  const value =
    normalizeCommandText(text);

  return [
    'hayır',
    'hayir',
    'iptal',
    'vazgeç',
    'vazgec',
    'no'
  ].includes(value);
}


async function executeHaccpInterpretation(
  interpretation
) {

  const intent =
    interpretation?.intent;

  const data =
    interpretation?.data || {};


  if (intent === 'get_batch') {

    return callHaccpBridge(
      'get_batch',
      {
        batch_no:
          data.batch_no
      }
    );
  }


  if (intent === 'create_batch') {

    return callHaccpBridge(
      'create_batch',
      {
        product_type:
          data.product_type,

        batch:
          data.batch
      }
    );
  }


  if (
    intent ===
    'record_process_measurement'
  ) {

    return callHaccpBridge(
      'record_process_measurement',
      {
        batch_no:
          data.batch_no,

        process:
          data.process,

        measurement:
          data.measurement,

        time:
          data.time,

        result:
          data.result
      }
    );
  }


  if (intent === 'record_ph') {

    return callHaccpBridge(
      'record_ph',
      {
        batch_no:
          data.batch_no,

        ph:
          data.ph,

        time:
          data.time
      }
    );
  }


  throw new Error(
    `Desteklenmeyen HACCP işlemi: ${intent}`
  );
}


async function processHaccpMessage(
  sessionId,
  text
) {

  const key =
    String(
      sessionId ||
      'unknown'
    );

  const pending =
    pendingConfirmations.get(
      key
    );


  // ----------------------------------------------------------
  // CONFIRM EXISTING PENDING WRITE
  // ----------------------------------------------------------

  if (
    pending &&
    isConfirmationYes(text)
  ) {


 let result;


    try {

      result =
        await executeHaccpInterpretation(
          pending
        );

    } catch (err) {

      return {
        type: 'execution_failed',
        summary:
          pending.summary || '',
        message:
          'İşlem kaydedilemedi.',
        error:
          err?.message ||
          String(err)
      };
    }


    if (!result?.ok) {

      return {
        type: 'execution_failed',
        summary:
          pending.summary || '',
        message:
          'İşlem kaydedilemedi.',
        bridge_result:
          result
      };
    }


    pendingConfirmations.delete(
      key
    );


    return {
      type: 'executed',
      summary:
        pending.summary || '',
      message:
        'İşlem başarıyla kaydedildi.',
      bridge_result:
        result
    };

    
  }


  // ----------------------------------------------------------
  // CANCEL EXISTING PENDING WRITE
  // ----------------------------------------------------------

  if (
    pending &&
    isConfirmationNo(text)
  ) {

    pendingConfirmations.delete(
      key
    );


    return {
      type: 'cancelled',
      message:
        'Bekleyen işlem iptal edildi.'
    };
  }


  // ----------------------------------------------------------
  // BLOCK NEW COMMAND WHILE CONFIRMATION IS PENDING
  // ----------------------------------------------------------

  if (pending) {

    return {
      type: 'pending_confirmation',
      summary:
        pending.summary || '',
      message:
        `${pending.summary || 'Bekleyen bir işlem var.'} Önce evet veya hayır ile cevap ver.`
    };
  }


  
  // ----------------------------------------------------------
  // INTERPRET NEW MESSAGE
  // ----------------------------------------------------------

  const interpretation =
    await interpretHaccpMessage(
      text
    );


  if (!interpretation?.ready) {

    return {
      type: 'question',
      question:
        interpretation?.question ||
        'Eksik bilgi var.',
      interpretation
    };
  }


  // ----------------------------------------------------------
  // READ OPERATIONS RUN DIRECTLY
  // ----------------------------------------------------------

  if (
    !interpretation
      .requires_confirmation
  ) {

    const result =
      await executeHaccpInterpretation(
        interpretation
      );


    return {
      type: 'read_result',
      interpretation,
      bridge_result:
        result
    };
  }


  // ----------------------------------------------------------
  // WRITE OPERATIONS WAIT FOR YES
  // ----------------------------------------------------------

  pendingConfirmations.set(
    key,
    interpretation
  );


  return {
    type:
      'confirmation_required',

    summary:
      interpretation.summary,

    message:
      `${interpretation.summary} Onaylıyor musun?`,

    interpretation
  };
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
              version: '1.1.0'
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
        // READ-ONLY BRIDGE SELF TEST
        // ----------------------------------------------------

        if (
          req.method === 'GET' &&
          url.pathname === '/bridge-selftest'
        ) {

          const result =
            await callHaccpBridge(
              'get_batch',
              {
                batch_no: '1'
              }
            );


          return sendJson(
            res,
            result.ok ? 200 : 500,
            {
              ok: Boolean(result.ok),
              action: 'get_batch',
              batch_no: '1',
              result
            }
          );
        }


                // ----------------------------------------------------
        // HACCP INTERPRETER TEST
        // ----------------------------------------------------

        if (
          req.method === 'GET' &&
          url.pathname === '/interpret-test'
        ) {

          const text =
            url.searchParams.get('text') || '';

          if (!text.trim()) {

            return sendJson(
              res,
              400,
              {
                ok: false,
                error: 'text parametresi gerekli'
              }
            );
          }


          const result =
            await interpretHaccpMessage(
              text
            );


          return sendJson(
            res,
            200,
            {
              ok: true,
              input: text,
              interpretation: result
            }
          );
        }


                // ----------------------------------------------------
        // HACCP MESSAGE + CONFIRMATION TEST
        // ----------------------------------------------------

        if (
          req.method === 'GET' &&
          url.pathname === '/message-test'
        ) {

          const text =
            url.searchParams.get('text') || '';

          const sessionId =
            url.searchParams.get('session') ||
            'test-user';


          if (!text.trim()) {

            return sendJson(
              res,
              400,
              {
                ok: false,
                error: 'text parametresi gerekli'
              }
            );
          }


          const result =
            await processHaccpMessage(
              sessionId,
              text
            );


          return sendJson(
            res,
            200,
            {
              ok: true,
              session_id: sessionId,
              input: text,
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
