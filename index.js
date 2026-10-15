'use strict';

const http = require('http');

const { randomUUID } = require('crypto');

const PORT = Number(process.env.PORT || 3000);

const HACCP_BRIDGE_URL =
  process.env.HACCP_BRIDGE_URL || '';

const HACCP_BRIDGE_SECRET =
  process.env.HACCP_BRIDGE_SECRET || '';

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || '';

const OPENAI_MODEL =
  process.env.OPENAI_MODEL || 'gpt-6-sol';

const HACCP_ROUTER_SECRET =
  process.env.HACCP_ROUTER_SECRET || '';


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

Okuma işlemi:

get_batch

Her kullanıcı mesajını operations dizisine ayır.

Kullanıcı tek işlem söylüyorsa operations içinde 1 eleman üret.

Kullanıcı bir mesajda birden fazla bağımsız işlem söylüyorsa
her işlemi operations içinde ayrı eleman olarak üret.

Her operation formatı:

{
  "intent": "unknown",
  "requires_confirmation": false,
  "summary": "",
  "data": {}
}

Yazma operationlarında:

requires_confirmation = true

get_batch operationında:

requires_confirmation = false

Eksik veya belirsiz bilgi varsa tahmin etme.

Herhangi bir operation güvenli şekilde uygulanamayacak kadar
eksik veya belirsizse:

ready = false

ve question alanında kullanıcının cevaplayabileceği
kısa ve açık bir soru üret.

Tüm operationlar yeterince açıksa:

ready = true
question = null

Üst seviye requires_confirmation:

operations içindeki en az bir işlem yazma işlemi ise true,
yalnızca okuma işlemleri varsa false olmalıdır.

summary alanı tüm mesajdaki işlemleri kısa şekilde özetlemelidir.

GEÇİCİ GERİYE UYUMLULUK KURALI:

Üst seviyedeki intent ve data alanları da mutlaka bulunmalıdır.

intent =
operations dizisindeki ilk işlemin intent değeri

data =
operations dizisindeki ilk işlemin data değeri

Bu iki alan geçicidir.
operations dizisi asıl yapılandırılmış işlem listesidir.

Yanıt SADECE geçerli JSON olsun.

Format:

{
  "ready": false,
  "requires_confirmation": false,
  "summary": "",
  "question": null,
  "intent": "unknown",
  "data": {},
  "operations": [
    {
      "intent": "unknown",
      "requires_confirmation": false,
      "summary": "",
      "data": {}
    }
  ]
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

Örnek:

Kullanıcı:
"18 numaralı parti pH 4.46 saat 17.20 ve soğutma sıcaklığı 6 derece saat 18.00"

operations içinde iki ayrı işlem üret:

1. record_ph
2. record_process_measurement

İki işlemi tek operation içinde birleştirme.
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

const executingConfirmations =
  new Set();

async function loadPendingConfirmation(
  key
) {

  const local =
    pendingConfirmations.get(
      key
    );


  if (local) {

    return {
      ok: true,
      pending:
        local,
      source:
        'memory'
    };
  }


  try {

    const result =
      await callHaccpBridge(
        'get_pending_confirmation',
        {
          session_id:
            key
        }
      );


    if (!result?.ok) {

      return {
        ok: false,

        error:
          result?.error ||
          'Bekleyen onay okunamadı',

        bridge_result:
          result
      };
    }


    if (!result.found) {

      return {
        ok: true,
        pending: null,
        source:
          'bridge'
      };
    }


    if (
      !result.pending ||
      typeof result.pending !==
        'object' ||
      Array.isArray(
        result.pending
      )
    ) {

      return {
        ok: false,

        error:
          'Bekleyen onay verisi geçersiz',

        bridge_result:
          result
      };
    }


    pendingConfirmations.set(
      key,
      result.pending
    );


    return {
      ok: true,

      pending:
        result.pending,

      source:
        'bridge'
    };

  } catch (err) {

    return {
      ok: false,

      error:
        err?.message ||
        String(err),

      bridge_result:
        null
    };
  }
}


async function persistPendingConfirmation(
  key,
  pending,
  actorId,
  actorName
) {

  try {

    const result =
      await callHaccpBridge(
        'save_pending_confirmation',
        {
          session_id:
            key,

          actor_id:
            actorId,

          actor_name:
            actorName,

          pending
        }
      );


    if (
      !result?.ok ||
      result?.verified !== true
    ) {

      return {
        ok: false,

        error:
          result?.error ||
          'Bekleyen onay kaydedilemedi',

        bridge_result:
          result
      };
    }


    return {
      ok: true,
      bridge_result:
        result
    };

  } catch (err) {

    return {
      ok: false,

      error:
        err?.message ||
        String(err),

      bridge_result:
        null
    };
  }
}


async function clearPendingConfirmation(
  key
) {

  try {

    const result =
      await callHaccpBridge(
        'delete_pending_confirmation',
        {
          session_id:
            key
        }
      );


    if (
      !result?.ok ||
      result?.verified !== true
    ) {

      return {
        ok: false,

        error:
          result?.error ||
          'Bekleyen onay silinemedi',

        bridge_result:
          result
      };
    }


    pendingConfirmations.delete(
      key
    );


    return {
      ok: true,
      bridge_result:
        result
    };

  } catch (err) {

    return {
      ok: false,

      error:
        err?.message ||
        String(err),

      bridge_result:
        null
    };
  }
}


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
        operation_id:
          interpretation.operation_id,

        actor_id:
          interpretation.actor_id,

        actor_name:
          interpretation.actor_name,

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
        operation_id:
          interpretation.operation_id,

        actor_id:
          interpretation.actor_id,

        actor_name:
          interpretation.actor_name,

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
        operation_id:
          interpretation.operation_id,

        actor_id:
          interpretation.actor_id,

        actor_name:
          interpretation.actor_name,

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

async function executeHaccpOperations(
  interpretation
) {

  const operations =
    Array.isArray(
      interpretation?.operations
    ) &&
    interpretation.operations.length
      ? interpretation.operations
      : [interpretation];


  const results = [];


  for (
    let index = 0;
    index < operations.length;
    index++
  ) {

    const operation =
      operations[index];


    try {

      const bridgeResult =
        await executeHaccpInterpretation(
          operation
        );


      const needsVerification =
        Boolean(
          operation
            ?.requires_confirmation
        );


      const verified =
        needsVerification
          ? bridgeResult?.verified === true
          : true;


      const ok =
        Boolean(
          bridgeResult?.ok
        ) &&
        verified;


      results.push({
        index,

        intent:
          operation?.intent ||
          'unknown',

        ok,

        verified,

        bridge_result:
          bridgeResult
      });


      if (!ok) {

        return {
          ok: false,

          verified: false,

          partial_failure:
            results
              .slice(
                0,
                -1
              )
              .some(
                item =>
                  item.ok
              ),

          failed_index:
            index,

          results
        };
      }

    } catch (err) {

      results.push({
        index,

        intent:
          operation?.intent ||
          'unknown',

        ok: false,

        verified: false,

        error:
          err?.message ||
          String(err)
      });


      return {
        ok: false,

        verified: false,

        partial_failure:
          results
            .slice(
              0,
              -1
            )
            .some(
              item =>
                item.ok
            ),

        failed_index:
          index,

        results
      };
    }
  }


  return {
    ok: true,

    verified: true,

    partial_failure: false,

    results
  };
}


async function processHaccpMessage(
  sessionId,
  text,
  actor = {}
) {

  const key =
    String(
      sessionId ||
      'unknown'
    );


  const actorId =
    String(
      actor.id ||
      key
    ).trim();


  const actorName =
    String(
      actor.name ||
      ''
    ).trim();

  const pendingState =
    await loadPendingConfirmation(
      key
    );


  if (!pendingState.ok) {

    return {
      type:
        'pending_state_unavailable',

      message:
        'Bekleyen onay durumu kontrol edilemedi. Güvenlik için yeni işlem başlatılmadı.',

      error:
        pendingState.error,

      bridge_result:
        pendingState.bridge_result
    };
  }


  const pending =
    pendingState.pending;


 if (
    executingConfirmations.has(
      key
    )
  ) {

    return {
      type: 'execution_in_progress',
      message:
        'Bu işlem şu anda kaydediliyor. Lütfen tekrar göndermeyin.'
    };
  }
  

  // ----------------------------------------------------------
  // CONFIRM EXISTING PENDING WRITE
  // ----------------------------------------------------------

  if (
    pending &&
    isConfirmationYes(text)
  ) {


 let result;


    executingConfirmations.add(
      key
    );


    try {

      result =
        await executeHaccpOperations(
          pending
        );

    } catch (err) {

      executingConfirmations.delete(
        key
      );


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


    executingConfirmations.delete(
      key
    );

  if (!result?.ok) {

      if (result?.partial_failure) {

        
      const clearResult =
          await clearPendingConfirmation(
            key
          );


        if (!clearResult.ok) {

          return {
            type:
              'partial_failure_cleanup_failed',

            summary:
              pending.summary || '',

            message:
              'Bazı işlemler tamamlandı ancak başarısız işlem var ve bekleyen onay kaydı temizlenemedi.',

            operation_results:
              result.results || [],

            cleanup_result:
              clearResult.bridge_result
          };
        }

        return {
          type: 'partial_failure',

          summary:
            pending.summary || '',

          message:
            'Bazı işlemler tamamlandı ancak en az bir işlem başarısız oldu. Başarısız işlemi yeni komut olarak tekrar gönder.',

          operation_results:
            result.results || []
        };
      }

 const failedResult =
        result
          ?.results
          ?.[result.failed_index];


      const definitiveFailure =
        failedResult
          ?.bridge_result
          ?.ok === false;


      if (definitiveFailure) {

        const clearResult =
          await clearPendingConfirmation(
            key
          );


        if (!clearResult.ok) {

          return {
            type:
              'execution_failed_cleanup_failed',

            summary:
              pending.summary || '',

            message:
              'İşlem başarısız oldu ancak bekleyen onay kaydı temizlenemedi.',

            operation_results:
              result?.results || [],

            cleanup_result:
              clearResult.bridge_result
          };
        }


        return {
          type:
            'execution_failed',

          summary:
            pending.summary || '',

          message:
            `İşlem kaydedilemedi: ${
              failedResult
                ?.bridge_result
                ?.error ||
              'İşlem başarısız oldu.'
            }`,

          operation_results:
            result?.results || []
        };
      }


      return {
        type:
          'execution_uncertain',

        summary:
          pending.summary || '',

        message:
          'İşlem sonucu kesinleştirilemedi. Bekleyen onay güvenlik için korundu.',

        operation_results:
          result?.results || [],

        bridge_result:
          result
      };
      
    }
  

     if (result?.verified !== true) {

      return {
        type: 'verification_failed',
        summary:
          pending.summary || '',
        message:
          'İşlem sonucu Sheet üzerinden doğrulanamadı. Başarılı kabul edilmedi.',
        bridge_result:
          result
      };
    }
    
    const clearResult =
      await clearPendingConfirmation(
        key
      );


    if (!clearResult.ok) {

      return {
        type:
          'executed_cleanup_failed',

        summary:
          pending.summary || '',

        message:
          'İşlem başarıyla kaydedildi ve doğrulandı ancak bekleyen onay kaydı temizlenemedi.',

        bridge_result:
          result,

        cleanup_result:
          clearResult.bridge_result
      };
    }
    


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

    const clearResult =
      await clearPendingConfirmation(
        key
      );


    if (!clearResult.ok) {

      return {
        type:
          'cancellation_failed',

        message:
          'Bekleyen işlem kalıcı kayıttan silinemedi. İptal tamamlanmadı.',

        error:
          clearResult.error,

        bridge_result:
          clearResult.bridge_result
      };
    }


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
      await executeHaccpOperations(
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

  const sourceOperations =
    Array.isArray(
      interpretation.operations
    ) &&
    interpretation.operations.length
      ? interpretation.operations
      : [
          {
            intent:
              interpretation.intent,

            requires_confirmation:
              interpretation
                .requires_confirmation,

            summary:
              interpretation.summary,

            data:
              interpretation.data || {}
          }
        ];


  const pendingOperations =
    sourceOperations.map(
      (operation) => ({
        ...operation,

        operation_id:
          operation
            .requires_confirmation
            ? (
                operation.operation_id ||
                randomUUID()
              )
            : operation.operation_id,

        actor_id:
          actorId,

        actor_name:
          actorName
      })
    );


  const pendingInterpretation = {
    ...interpretation,

    operations:
      pendingOperations,

    actor_id:
      actorId,

    actor_name:
      actorName
  };


  const persistentPending =
    await persistPendingConfirmation(
      key,
      pendingInterpretation,
      actorId,
      actorName
    );


  if (!persistentPending.ok) {

    return {
      type:
        'pending_persistence_failed',

      summary:
        interpretation.summary,

      message:
        'Onay bekleyen işlem kalıcı olarak saklanamadı. Güvenlik için onaya açılmadı.',

      error:
        persistentPending.error,

      bridge_result:
        persistentPending.bridge_result
    };
  }


  pendingConfirmations.set(
    key,
    pendingInterpretation
  );


  return {
    type:
      'confirmation_required',

    summary:
      interpretation.summary,

    message:
      `${interpretation.summary} Onaylıyor musun?`,

    interpretation:
      pendingInterpretation
  };
}


// ============================================================
// SERVER
// ============================================================


function formatHaccpReply(
  result
) {

  if (!result) {

    return 'HACCP işlemi tamamlanamadı.';
  }


  if (
    result.type === 'question'
  ) {

    return (
      result.question ||
      'Eksik bilgi var.'
    );
  }


  if (result.message) {

    return String(
      result.message
    );
  }


  if (
    result.type ===
    'read_result'
  ) {

    const firstResult =
      result
        ?.bridge_result
        ?.results
        ?.[0]
        ?.bridge_result;


    if (
      firstResult?.found &&
      firstResult?.batch
    ) {

      return (
        'Parti ' +
        String(
          firstResult
            .batch
            .batch_no || ''
        ) +
        ' bulundu. Sayfa: ' +
        String(
          firstResult
            .batch
            .sheet_name || ''
        ) +
        '.'
      );
    }


    return (
      firstResult?.error ||
      'Kayıt bulunamadı.'
    );
  }


  if (result.summary) {

    return String(
      result.summary
    );
  }


  return 'HACCP işlemi tamamlandı.';
}


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


        const actorName =
            url.searchParams.get('actor') ||
            '';


          const result =
            await processHaccpMessage(
              sessionId,
              text,
              {
                id:
                  sessionId,

                name:
                  actorName
              }
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
        // PRODUCTION HACCP MESSAGE
        // ----------------------------------------------------

        if (
          req.method === 'POST' &&
          url.pathname === '/message'
        ) {

          const routerSecret =
            String(
              req.headers[
                'x-haccp-router-secret'
              ] || ''
            );


          if (
            !HACCP_ROUTER_SECRET ||
            routerSecret !==
              HACCP_ROUTER_SECRET
          ) {

            return sendJson(
              res,
              401,
              {
                ok: false,
                error: 'unauthorized'
              }
            );
          }


          const bodyText =
            await readBody(req);


          let body = {};


          try {

            body =
              JSON.parse(
                bodyText || '{}'
              );

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


          const waId =
            String(
              body.wa_id || ''
            ).trim();


          const actorName =
            String(
              body.actor_name || ''
            ).trim();


          const text =
            String(
              body.text || ''
            ).trim();


          if (!waId) {

            return sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  'wa_id gerekli'
              }
            );
          }


          if (!text) {

            return sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  'text gerekli'
              }
            );
          }


          const result =
            await processHaccpMessage(
              waId,
              text,
              {
                id:
                  waId,

                name:
                  actorName
              }
            );


          return sendJson(
            res,
            200,
            {
              ok: true,

              wa_id:
                waId,

              reply:
                formatHaccpReply(
                  result
                ),

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
