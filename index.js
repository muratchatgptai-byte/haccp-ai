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

function getHaccpToday() {

  return new Intl.DateTimeFormat(
    'tr-TR',
    {
      timeZone:
        'Europe/Istanbul',

      day:
        '2-digit',

      month:
        '2-digit',

      year:
        'numeric'
    }
  ).format(
    new Date()
  );
}


function positiveNumber(
  value
) {

  const normalized =
    String(
      value ?? ''
    )
      .trim()
      .replace(
        ',',
        '.'
      );


  const number =
    Number(
      normalized
    );


  if (
    !Number.isFinite(
      number
    ) ||
    number <= 0
  ) {

    return null;
  }


  return number;
}


function getStartProductionMissingFields(
  data
) {

  const missing =
    [];


  if (
    ![
      'sour_cream',
      'stp',
      'dessert'
    ].includes(
      data?.product_type
    )
  ) {

    missing.push(
      'ürün tipi'
    );
  }


  if (
    positiveNumber(
      data?.batch_count
    ) === null
  ) {

    missing.push(
      'batch adedi'
    );
  }


  if (
    !String(
      data?.production_date || ''
    ).trim()
  ) {

    missing.push(
      'üretim tarihi'
    );
  }


  if (
    !String(
      data?.start_time || ''
    ).trim()
  ) {

    missing.push(
      'başlangıç saati'
    );
  }


  return missing;
}

function getCreateBatchMissingFields(
  data
) {

  const batch =
    data?.batch || {};


  const missing =
    [];


  if (
    ![
      'sour_cream',
      'stp',
      'dessert'
    ].includes(
      data?.product_type
    )
  ) {

    missing.push(
      'ürün tipi'
    );
  }


  if (!String(batch.date || '').trim()) {

    missing.push(
      'üretim tarihi'
    );
  }


  


  if (!String(batch.product || '').trim()) {

    missing.push(
      'ürün adı'
    );
  }


  if (
    positiveNumber(
      batch.grammage
    ) === null
  ) {

    missing.push(
      'gramaj'
    );
  }


  if (!String(batch.unit || '').trim()) {

    missing.push(
      'birim'
    );
  }


  if (
    positiveNumber(
      batch.quantity
    ) === null
  ) {

    missing.push(
      'miktar'
    );
  }


  if (
    positiveNumber(
      batch.batch_count
    ) === null
  ) {

    missing.push(
      'batch adedi'
    );
  }


  return missing;
}


function normalizeHaccpInterpretation(
  interpretation
) {

  const sourceOperations =
    Array.isArray(
      interpretation?.operations
    ) &&
    interpretation.operations.length
      ? interpretation.operations
      : [
          {
            intent:
              interpretation?.intent ||
              'unknown',

            requires_confirmation:
              Boolean(
                interpretation
                  ?.requires_confirmation
              ),

            summary:
              interpretation?.summary ||
              '',

            data:
              interpretation?.data ||
              {}
          }
        ];


  const allMissing =
    [];


  const normalizedOperations =
    sourceOperations.map(
      operation => {

if (
  operation?.intent ===
  'start_production'
) {

  const data =
    operation?.data || {};


  const productType =
    String(
      data.product_type || ''
    ).trim();


  const productNames = {
    sour_cream: 'Ekşi Krema',
    stp: 'Taze Peynir',
    dessert: 'Sütlü Tatlı'
  };


  const batchCount =
    positiveNumber(
      data.batch_count
    );


  const normalizedData = {
    ...data,

    product_type:
      productType,

    product_name:
      productNames[productType] ||
      String(
        data.product_name || ''
      ).trim(),

    recipe:
      String(
        data.recipe || ''
      ).trim(),

    batch_count:
      batchCount === null
        ? String(
            data.batch_count || ''
          ).trim()
        : String(batchCount),

    production_date:
      String(
        data.production_date ||
        getHaccpToday()
      ).trim(),

    start_time:
      String(
        data.start_time || ''
      ).trim()
  };


  const missing =
    getStartProductionMissingFields(
      normalizedData
    );


  allMissing.push(
    ...missing
  );


  let summary =
    operation?.summary ||
    'Yeni üretim açılacak.';


  if (!missing.length) {

    summary =
      `Yeni üretim açılacak: ${normalizedData.product_name}, ${normalizedData.production_date}, ${normalizedData.batch_count} batch, başlangıç ${normalizedData.start_time}.`;
  }


  return {
    ...operation,

    requires_confirmation:
      true,

    summary,

    data:
      normalizedData
  };
}
        
        if (
          operation?.intent !==
          'create_batch'
        ) {

          return operation;
        }


        const data =
          operation?.data || {};


        const originalBatch =
          data?.batch &&
          typeof data.batch ===
            'object'
            ? data.batch
            : {};


        const batch = {
          ...originalBatch,

          batch_no:
            '',

          output_kg:
            '',

          invoice_info:
            String(
              originalBatch
                .invoice_info ||
              ''
            ).trim(),

          raw_material_lots:
            String(
              originalBatch
                .raw_material_lots ||
              ''
            ).trim()
        };


        const grammage =
          positiveNumber(
            batch.grammage
          );


        const quantity =
          positiveNumber(
            batch.quantity
          );


        if (grammage !== null) {

          batch.grammage =
            String(
              grammage
            );
        }


        if (quantity !== null) {

          batch.quantity =
            String(
              quantity
            );
        }


        if (
          grammage !== null &&
          quantity !== null
        ) {

          batch.total_production =
            String(
              grammage *
              quantity
            );

        } else {

          batch.total_production =
            '';
        }


        const normalizedData = {
          ...data,
          batch
        };


        const missing =
          getCreateBatchMissingFields(
            normalizedData
          );


        allMissing.push(
          ...missing
        );


        let summary =
          operation?.summary ||
          'Yeni üretim partisi oluşturulacak.';


        if (!missing.length) {

          const totalKg =
            Number(
              batch.total_production
            ) / 1000;


          summary =
            `Yeni üretim partisi oluşturulacak: ${batch.product}, ${batch.date}, reçete ${batch.recipe}, ${batch.quantity} ${batch.unit}, toplam ${totalKg} kg, ${batch.batch_count} batch. Parti numarası global sıradan sistem tarafından atanacak.`;
        }


        return {
          ...operation,

          requires_confirmation:
            true,

          summary,

          data:
            normalizedData
        };
      }
    );


  const uniqueMissing =
    [
      ...new Set(
        allMissing
      )
    ];


  const firstOperation =
    normalizedOperations[0] ||
    {
      intent:
        'unknown',
      data:
        {}
    };


  const normalized = {
    ...interpretation,

    operations:
      normalizedOperations,

    intent:
      firstOperation.intent,

    data:
      firstOperation.data
  };

const hasCreateBatch =
  normalizedOperations.some(
    operation =>
      operation?.intent ===
      'create_batch'
  );


const hasStartProduction =
  normalizedOperations.some(
    operation =>
      operation?.intent ===
      'start_production'
  );


const hasManagedWrite =
  hasCreateBatch ||
  hasStartProduction;


if (uniqueMissing.length) {

  normalized.ready =
    false;

  normalized.requires_confirmation =
    true;

  normalized.question =
    hasStartProduction &&
    !hasCreateBatch
      ? `Yeni üretim başlangıcı için eksik bilgiler: ${uniqueMissing.join(', ')}.`
      : `Eksik bilgiler: ${uniqueMissing.join(', ')}.`;

  return normalized;
}


if (
  hasManagedWrite &&
  normalizedOperations.every(
    operation =>
      [
        'create_batch',
        'start_production'
      ].includes(
        operation?.intent
      )
  )
) 

{

  normalized.ready =
    true;

  normalized.requires_confirmation =
    true;

  normalized.question =
    null;

  if (
    normalizedOperations.length === 1
  ) {

    normalized.summary =
      normalizedOperations[0]
        .summary;
  }
}
 

  return normalized;
}

async function interpretHaccpMessage(
  text,
  intakeDraft = null
) {

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
start_production
create_batch
record_process_measurement
record_ph
unknown

Yazma işlemleri:

start_production
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

start_production için data:

{
  "product_type": "sour_cream | stp | dessert",
  "product_name": "",
  "recipe": "",
  "batch_count": "",
  "production_date": "",
  "start_time": ""
}

start_production kuralları:

- Bu işlem mamul partisi oluşturmaz.
- Parti numarası oluşturma.
- Bu intent kazandaki ortak üretim/proses başlangıcı içindir.
- Kullanıcı "ekşi krema 3 batch başladı 09:10" gibi yazarsa start_production kullan.
- sour_cream = Ekşi Krema
- stp = Taze Peynir
- dessert = Sütlü Tatlı
- batch_count reçetenin kaç kez yapıldığını ifade eder.
- batch_count ambalaj adedi değildir.
- Gramaj ve ürün adedi üretim başlangıcında istenmez.
- Farklı ambalajlara ait parti numaraları daha sonra dolum bilgisi geldiğinde oluşturulacaktır.
- production_date kullanıcı tarih belirtmezse bugünün tarihi olsun.
- start_time gerçek üretim başlangıç saatidir.
- Zorunlu bilgiler: product_type, batch_count, production_date, start_time.
- product_name ürün tipine göre Ekşi Krema, Taze Peynir veya Sütlü Tatlı olarak doldurulabilir.
- recipe eksikse üretim başlangıcını engelleme.
- Eksik zorunlu bilgi varsa yalnızca eksik bilgiyi sor.

Örnek:

Kullanıcı:
"Ekşi krema 3 batch 09:10"

start_production üret:
product_type = sour_cream
product_name = Ekşi Krema
batch_count = 3
production_date = bugünün tarihi
start_time = 09:10

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

create_batch kuralları:

- batch_no kullanıcıdan İSTENMEZ.
- batch_no alanını boş bırak.
- Parti numarası sistem tarafından onaydan sonra global sıradan oluşturulur.
- Parti numarası YALNIZCA rakamdır.
- Örnek sıra: 4 -> 5 -> 6.
- EK-1, STP-1, ST-1 gibi değerler reçete kodudur; parti numarası değildir.
- Parti numarasına ürün veya reçete prefix'i ekleme.

- output_kg üretim bitmeden bilinmez.
- output_kg alanını boş bırak.
- Kullanıcıdan parti açılışında çıkan miktarı isteme.

- total_production kullanıcıdan istenmez.
- total_production alanını boş bırak.
- Sistem gramaj x quantity ile kendisi hesaplayacak.

- invoice_info ve raw_material_lots parti açılışında opsiyoneldir.
- Bunlar eksik diye yeni parti açılmasını engelleme.


Yeni parti için zorunlu bilgiler:

product_type
date
product
grammage
unit
quantity
batch_count

recipe opsiyoneldir.
recipe boşsa eksik bilgi sayma ve kullanıcıdan isteme.

Eksik zorunlu bilgiler varsa sadece eksik bilgileri sor.


Bilinen bilgileri tekrar isteme.

grammage değerini gram cinsinden sayısal döndür.
Örnek:
"4 kg" -> "4000"

quantity sayısal olsun.

Bugünün tarihi Türkiye için:
${getHaccpToday()}

Kullanıcı "bugün" derse bu tarihi kullan.

Eğer kullanıcı mesajında
"DEVAM EDEN GİRİŞ TASLAĞI"
bölümü varsa:

- Taslakta daha önce doldurulmuş bilgileri koru.
- Kullanıcı açıkça değiştirmedikçe mevcut değerleri değiştirme.
- Kullanıcının yeni mesajını yalnızca eksik bilgileri tamamlamak için kullan.
- Taslaktaki mevcut intent değerini koru.
- Taslak start_production ise intent start_production olarak kalmalıdır.
- Taslak create_batch ise intent create_batch olarak kalmalıdır.
- Kullanıcı sadece "09:10", "3 batch", "EK-1" gibi kısa cevaplar verebilir.
- Bu kısa cevabı taslaktaki doğru eksik alana yerleştir.
- Daha önce bilinen bilgileri tekrar sorma.

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
                intakeDraft
                  ? [
                      'DEVAM EDEN GİRİŞ TASLAĞI:',
                      JSON.stringify(
                        intakeDraft
                      ),
                      '',
                      'KULLANICININ YENİ MESAJI:',
                      String(
                        text || ''
                      )
                    ].join('\n')
                  : String(
                      text || ''
                    )
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

return normalizeHaccpInterpretation(
    parseJsonText(
      outputText
    )
  );
  
}


// ============================================================
// HACCP CONFIRMATION FLOW
// ============================================================

const pendingConfirmations =
  new Map();

const executingConfirmations =
  new Set();


const haccpConversationHistory =
  new Map();


function getHaccpConversationHistory(
  key
) {

  const items =
    haccpConversationHistory.get(
      String(
        key || ''
      )
    );


  return Array.isArray(
    items
  )
    ? items
    : [];
}


function rememberHaccpConversation(
  key,
  userText,
  assistantText
) {

  const history =
    getHaccpConversationHistory(
      key
    ).slice();


  const user =
    String(
      userText || ''
    ).trim();


  const assistant =
    String(
      assistantText || ''
    ).trim();


  if (user) {

    history.push({
      role:
        'user',

      content:
        user
    });
  }


  if (assistant) {

    history.push({
      role:
        'assistant',

      content:
        assistant
    });
  }


  haccpConversationHistory.set(

    String(
      key || ''
    ),

    history.slice(
      -12
    )
  );
}


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


  let lastError =
    null;

  let lastBridgeResult =
    null;


  for (
    let attempt = 1;
    attempt <= 2;
    attempt++
  ) {

    try {

      const result =
        await callHaccpBridge(
          'get_pending_confirmation',
          {
            session_id:
              key
          }
        );


      lastBridgeResult =
        result;


      if (!result?.ok) {

        lastError =
          result?.error ||
          'Bekleyen onay okunamadı';


        console.error(
          JSON.stringify({
            type:
              'pending_confirmation_read_failed',

            session_id:
              key,

            attempt,

            error:
              lastError
          })
        );

      } else {

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
      }

    } catch (err) {

      lastError =
        err?.message ||
        String(err);


      console.error(
        JSON.stringify({
          type:
            'pending_confirmation_read_failed',

          session_id:
            key,

          attempt,

          error:
            lastError
        })
      );
    }


    if (attempt < 2) {

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            750
          )
      );
    }
  }


  return {
    ok: false,

    error:
      lastError ||
      'Bekleyen onay okunamadı',

    bridge_result:
      lastBridgeResult
  };
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

async function executeHaccpReadTool(
  toolName,
  args = {}
) {

  if (toolName === 'list_sheets') {

    return callHaccpBridge(
      'list_sheets',
      {}
    );
  }


  if (toolName === 'read_range') {

    return callHaccpBridge(
      'read_sheet_range',
      {
        sheet_name:
          String(
            args.sheet_name || ''
          ).trim(),

        a1_range:
          String(
            args.a1_range || ''
          ).trim()
      }
    );
  }


  if (toolName === 'search_workbook') {

    return callHaccpBridge(
      'search_workbook',
      {
        query:
          String(
            args.query || ''
          ).trim(),

        sheet_name:
          String(
            args.sheet_name || ''
          ).trim(),

        max_results:
          Number(
            args.max_results || 20
          )
      }
    );
  }


  return {
    ok: false,
    error:
      `Bilinmeyen okuma aracı: ${toolName}`
  };
}


async function runHaccpAssistantTurn(
  key,
  text,
  state = {}
) {

  if (!OPENAI_API_KEY) {

    throw new Error(
      'OPENAI_API_KEY tanımlı değil'
    );
  }


  const history =
    getHaccpConversationHistory(
      key
    );


  // ----------------------------------------------------------
  // AI'YA ÖNCE SADECE WORKBOOK HARİTASINI VER
  // İçeriği kendisi gerektiğinde okuyacak.
  // ----------------------------------------------------------

  let workbookDirectory;


  try {

    workbookDirectory =
      await executeHaccpReadTool(
        'list_sheets'
      );

  } catch (err) {

    workbookDirectory = {
      ok: false,
      error:
        err?.message ||
        String(err)
    };
  }


  const stateContext = {

    today:
      getHaccpToday(),

    pending_confirmation:
      state.pending
        ? {
            summary:
              state.pending.summary || '',

            state_kind:
              state.pending.state_kind ||
              'confirmation'
          }
        : null,

    intake_draft:
      state.intakeDraft ||
      null,

    workbook_directory:
      workbookDirectory,

    write_capabilities: [
      'yeni üretim açma',
      'açık üretime dolum/parti bağlama',
      'yeni bağımsız parti oluşturma',
      'açık üretime proses tamamlanma kaydı yazma',
      'partiye proses ölçümü yazma',
      'partiye pH kaydı yazma'
    ]
  };


  const systemPrompt = `
Sen normal ChatGPT zekâsıyla çalışan genel amaçlı bir yapay zekâ asistanısın.
Aynı zamanda Boşnak Tatları HACCP çalışma alanının içindesin.

Zekânı HACCP komut listeleriyle sınırlandırma.
Normal muhakeme, açıklama, eleştiri, karşılaştırma ve genel sohbet yeteneklerini kullan.

HACCP workbook'una canlı olarak bakabilirsin.
Workbook yapısını ezberlenmiş kabul etme; gerektiğinde araçları kullanarak kendin incele.
Kullanıcının sorusu güncel Sheet verisine bağlıysa cevap vermeden önce ilgili veriyi mutlaka oku.

OKUMA ARAÇLARIN:

1. list_sheets
Workbook'taki sheetleri ve kullanılan boyutlarını gösterir.

2. read_range
Belirli bir sheet'teki A1 aralığını okur.

arguments:
{
  "sheet_name": "",
  "a1_range": ""
}

3. search_workbook
Workbook'un tamamında veya belirtilen sheet'te metin/değer arar.

arguments:
{
  "query": "",
  "sheet_name": "",
  "max_results": 20
}

Bir okuma aracını kullanmak istediğinde yalnızca şu JSON'u döndür:

{
  "mode": "tool",
  "answer": "",
  "tool": {
    "name": "list_sheets | read_range | search_workbook",
    "arguments": {}
  }
}

Araç sonucu sana sonraki turda verilecektir.
Gerekirse birden fazla tur araç kullanabilirsin.

YAZMA:

Sheet'e doğrudan keyfi hücre yazma yetkin yoktur.

Yalnızca SİSTEM DURUMU içinde belirtilen write_capabilities
mevcut güvenli yazma motoru tarafından uygulanabilir.

Kullanıcı mevcut bir yazma yeteneğiyle yapılabilecek değişiklik istiyorsa:

{
  "mode": "action",
  "answer": "",
  "action_hint": "kullanıcının ne istediğini kısa ve açık tarif et"
}

Yazma işlemini kendin yapma.
Mevcut onay ve doğrulama motoru devralacaktır.

Kullanıcı bir değişiklik istiyor fakat mevcut write_capabilities
içinde bunu yapabilecek el yoksa:

{
  "mode": "unsupported",
  "answer": "İstediğini anladım...",
  "action_hint": ""
}

Bu durumda neyin eksik olduğunu somut söyle.
Yapılmış gibi davranma.

Kullanıcı bilgi, analiz, yorum, karşılaştırma,
tavsiye veya normal sohbet istiyorsa:

{
  "mode": "chat",
  "answer": "doğal cevabın",
  "action_hint": ""
}

KURALLAR:

- Sheet verisi gerekiyorsa tahmin etme; oku.
- Hangi sheet veya range gerektiğine kendin karar ver.
- Kullanıcı "bu", "burada", "şu üretim" gibi bağlama bağlı ifade kullanırsa konuşma geçmişini ve workbook'u birlikte değerlendir.
- Birden fazla olası kayıt varsa ve sonuç değişecekse bunu tespit et; gerekirse soru sor.
- Bekleyen onay varken kullanıcı açıklama sorabilir; onayı bozma.
- Kullanıcının sorusunu zorla kayıt komutuna dönüştürme.
- HACCP dışı genel bir soru gelirse normal ChatGPT gibi cevap ver; workbook aracı kullanmak zorunda değilsin.
- Cevaplar Türkçe, doğal ve doğrudan olsun.

Tool istemediğin son cevapta yalnızca geçerli JSON döndür.
`.trim();


  const transcript = [

    {
      role: 'system',
      content:
        systemPrompt
    },

    ...history.map(
      item => ({
        role:
          item.role,

        content:
          item.content
      })
    ),

    {
      role: 'user',

      content: [

        'SİSTEM DURUMU:',

        JSON.stringify(
          stateContext
        ),

        '',

        'KULLANICININ YENİ MESAJI:',

        String(
          text || ''
        )

      ].join('\n')
    }
  ];


  // ----------------------------------------------------------
  // AI KENDİSİ DOSYAYI GEZSİN
  // Maksimum 4 read turu: latency'nin kontrolden çıkmaması için.
  // ----------------------------------------------------------

  for (
    let round = 0;
    round < 4;
    round++
  ) {

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

          body:
            JSON.stringify({

              model:
                OPENAI_MODEL,

              input:
                transcript,

              reasoning: {
                effort:
                  'medium'
              },

              max_output_tokens:
                1200
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
      extractOpenAIText(
        body
      );


    if (!outputText) {

      throw new Error(
        'OpenAI boş asistan cevabı döndürdü'
      );
    }


    let parsed;


    try {
    
      parsed =
        parseJsonText(
          outputText
        );
    
    } catch {
    
      return {
        mode:
          'chat',
    
        answer:
          outputText,
    
        action_hint:
          ''
      };
    }


    // --------------------------------------------------------
    // AI DOSYAYA BAKMAK İSTİYOR
    // --------------------------------------------------------

    if (
      parsed?.mode === 'tool'
    ) {

      const toolName =
        String(
          parsed?.tool?.name || ''
        ).trim();


      const toolArgs =
        parsed?.tool?.arguments &&
        typeof parsed.tool.arguments ===
          'object' &&
        !Array.isArray(
          parsed.tool.arguments
        )
          ? parsed.tool.arguments
          : {};


      const toolResult =
        await executeHaccpReadTool(
          toolName,
          toolArgs
        );


      transcript.push(
        {
          role:
            'assistant',

          content:
            outputText
        },
        {
          role:
            'user',

          content: [
            'OKUMA ARACI SONUCU:',
            `tool=${toolName}`,
            JSON.stringify(
              toolResult
            ),
            '',
            'Bu sonucu değerlendir. Gerekirse başka bir okuma aracı kullan; yeterli bilgi varsa kullanıcıya cevap ver veya action/unsupported kararı üret.'
          ].join('\n')
        }
      );


      continue;
    }


    const allowedModes =
      new Set([
        'chat',
        'action',
        'unsupported'
      ]);


    const mode =
      allowedModes.has(
        parsed?.mode
      )
        ? parsed.mode
        : 'chat';


    return {

      mode,

      answer:
        String(
          parsed?.answer || ''
        ).trim(),

      action_hint:
        String(
          parsed?.action_hint || ''
        ).trim()
    };
  }


  return {
    mode: 'chat',

    answer:
      'Dosyayı incelerken yeterli sonuca ulaşamadım. Daha dar bir alan belirtirsen tekrar bakabilirim.',

    action_hint: ''
  };
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

if (intent === 'start_production') {

  return callHaccpBridge(
    'start_production',
    {
      operation_id:
        interpretation.operation_id,

      actor_id:
        interpretation.actor_id,

      actor_name:
        interpretation.actor_name,

      product_type:
        data.product_type,

      product_name:
        data.product_name,

      recipe:
        data.recipe,

      batch_count:
        data.batch_count,

      production_date:
        data.production_date,

      start_time:
        data.start_time
    }
  );
}

// ==========================================================
  // 6.5.4 - SAVE OPEN PRODUCTION MEASUREMENT
  // ==========================================================

  if (
    intent ===
    'record_open_production_measurement'
  ) {

    return callHaccpBridge(
      'record_open_production_measurement',
      {
        operation_id:
          interpretation.operation_id,

        actor_id:
          interpretation.actor_id,

        actor_name:
          interpretation.actor_name,

        production_id:
          data.production_id,

        process:
          data.process,

        measurement:
          data.measurement,

        time:
          data.time
      }
    );
  }


  if (
  intent ===
  'create_open_production_batch'
) {

  return callHaccpBridge(
    'create_open_production_batch',
    {
      operation_id:
        interpretation.operation_id,

      actor_id:
        interpretation.actor_id,

      actor_name:
        interpretation.actor_name,

      production_id:
        data.production_id,

      product_type:
        data.product_type,

      batch:
        data.batch
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


function getCreateBatchOperation(state) {
  const operations = Array.isArray(state?.operations)
    ? state.operations
    : [];

  return (
    operations.find(item => item?.intent === 'create_batch') ||
    (
      state?.intent === 'create_batch'
        ? {
            intent: 'create_batch',
            data: state?.data || {},
            summary: state?.summary || ''
          }
        : null
    )
  );
}


function isBatchPackagingCandidate(state) {
  const operation = getCreateBatchOperation(state);

  if (!operation) {
    return false;
  }

  const data = operation.data || {};
  const batch = data.batch || {};

  if (
    positiveNumber(batch.grammage) === null ||
    positiveNumber(batch.quantity) === null
  ) {
    return false;
  }

  return (
    !['sour_cream', 'stp', 'dessert']
      .includes(data.product_type) ||
    !String(batch.date || '').trim() ||
    !String(batch.product || '').trim() ||
    positiveNumber(batch.batch_count) === null
  );
}


function buildOpenProductionBatchOperation(
  draft,
  production,
  actorId,
  actorName
) {
  const source = getCreateBatchOperation(draft);
  const sourceBatch = source?.data?.batch || {};

  const grammage = positiveNumber(sourceBatch.grammage);
  const quantity = positiveNumber(sourceBatch.quantity);

  if (
    grammage === null ||
    quantity === null
  ) {
    throw new Error('Dolum gramajı veya adedi eksik');
  }

  const productionName =
    String(production?.product_name || '').trim();

  const productBase =
    /^balkano\b/i.test(productionName)
      ? productionName
      : `Balkano ${productionName}`;

  const batch = {
    ...sourceBatch,
    batch_no: '',
    date: String(production?.production_date || '').trim(),
    recipe: String(production?.recipe || '').trim(),
    product:
      `${productBase} ${grammage} gr`
        .replace(/\s+/g, ' ')
        .trim(),
    grammage: String(grammage),
    unit: String(sourceBatch.unit || 'Adet').trim(),
    quantity: String(quantity),
    total_production: String(grammage * quantity),
    batch_count:
      String(production?.batch_count || '').trim(),
    output_kg: ''
  };

  const totalKg =
    Number(batch.total_production) / 1000;

  const summary =
    `${productionName} açık üretimine ${batch.quantity} ${batch.unit}, ${batch.grammage} gr, toplam ${totalKg} kg dolum için yeni parti oluşturulacak. Parti numarası sistem tarafından otomatik atanacak.`;


return {
  intent:
    'create_open_production_batch',
  requires_confirmation: true,
  summary,
  operation_id: randomUUID(),
  actor_id: actorId,
  actor_name: actorName,
  data: {
    production_id:
      String(
        production?.production_id ||
        ''
      ).trim(),
    product_type:
      String(
        production?.product_type ||
        ''
      ).trim(),
    batch
  }
};

  
}


async function queueOpenProductionBatchConfirmation(
  key,
  draft,
  production,
  actorId,
  actorName
) {
  const operation =
    buildOpenProductionBatchOperation(
      draft,
      production,
      actorId,
      actorName
    );

  const pendingInterpretation = {
    state_kind: 'confirmation',
    ready: true,
    requires_confirmation: true,
    summary: operation.summary,
    intent:
  'create_open_production_batch',
    data: operation.data,
    operations: [operation],
    actor_id: actorId,
    actor_name: actorName
  };

  const saved =
    await persistPendingConfirmation(
      key,
      pendingInterpretation,
      actorId,
      actorName
    );

  if (!saved.ok) {
    return {
      type: 'pending_persistence_failed',
      message:
        'Parti onayı kaydedilemedi. İşlem yapılmadı.'
    };
  }

  pendingConfirmations.set(
    key,
    pendingInterpretation
  );

  return {
    type: 'confirmation_required',
    message:
      operation.summary +
      ' Onaylıyor musun?'
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


  const storedState =
    pendingState.pending;


  const intakeDraft =
    storedState
      ?.state_kind ===
      'intake_draft'
      ? storedState
      : null;


  const pending =
    intakeDraft
      ? null
      : storedState;


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
    

const firstWriteResult =
  result
    ?.results
    ?.[0]
    ?.bridge_result;


const createdBatchNo =
  firstWriteResult
    ?.action ===
    'create_batch'
      ? String(
          firstWriteResult
            ?.batch
            ?.batch_no ||
          ''
        ).trim()
      : '';


const startedProduction =
  firstWriteResult
    ?.action ===
    'start_production'
      ? firstWriteResult.production
      : null;


const startedProductionName =
  String(
    startedProduction
      ?.product_name ||
    ''
  ).trim();


const startedBatchCount =
  String(
    startedProduction
      ?.batch_count ||
    ''
  ).trim();


const startedStartTime =
  String(
    startedProduction
      ?.start_time ||
    ''
  ).trim();


return {
  type: 'executed',

  summary:
    pending.summary || '',

  message:
    createdBatchNo
      ? `Parti ${createdBatchNo} oluşturuldu ve doğrulandı.`
      : startedProduction
        ? `${startedProductionName} üretimi açıldı. ${startedBatchCount} batch, başlangıç ${startedStartTime}.`
        : 'İşlem başarıyla kaydedildi.',

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
  // GENERAL AI ASSISTANT LAYER
  // ----------------------------------------------------------

  let assistantDecision =
    null;


  try {

    assistantDecision =
      await runHaccpAssistantTurn(
        key,
        text,
        {
          pending,
          intakeDraft
        }
      );

  } catch (err) {

    console.error(
      JSON.stringify({
        type:
          'assistant_turn_failed',

        session_id:
          key,

        error:
          err?.message ||
          String(err)
      })
    );
  }


  if (
    assistantDecision &&
    assistantDecision.mode !==
      'action'
  ) {

    return {
      type:
        'assistant_reply',

      message:
        assistantDecision.answer ||
        'Bunu değerlendirdim ancak net bir cevap oluşturamadım.',

      assistant_mode:
        assistantDecision.mode
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

// ==========================================================
  // 6.5.2 - OPEN PRODUCTION LOOKUP
  // ==========================================================

  const lookupText =
    normalizeCommandText(text);

  if (
    /açık.*üretim|üretim.*listele/i
      .test(lookupText)
  ) {

    let productType = '';

    if (/ekşi|pavlaka/i.test(lookupText)) {
      productType = 'sour_cream';
    } else if (/peynir|stp/i.test(lookupText)) {
      productType = 'stp';
    } else if (/tatlı/i.test(lookupText)) {
      productType = 'dessert';
    }

    const result =
      await callHaccpBridge(
        'get_open_productions',
        {
          product_type: productType
        }
      );

    if (!result?.ok) {

      return {
        type: 'lookup_failed',
        message:
          result?.error ||
          'Açık üretimler sorgulanamadı.'
      };
    }

    const productions =
      result.productions || [];

    if (!productions.length) {

      return {
        type: 'lookup_result',
        message:
          'Açık üretim bulunamadı.'
      };
    }

    const lines = productions.map(
      (production, index) => {

        return (
          (index + 1) + '. ' +
          production.product_name +
          ' | ' +
          production.production_date +
          ' | ' +
          production.batch_count +
          ' batch | ' +
          production.start_time
        );
      }
    );

    return {
      type: 'lookup_result',
      message:
        'Açık üretimler:\n' +
        lines.join('\n')
    };
  }


// ==========================================================
  // 6.5.8 - MISSING PRODUCTION RECORDS LOOKUP
  // ==========================================================

  const missingCommand =
    normalizeCommandText(text);

  if (
    /eksik.*(?:kayıt|kayit|proses)|(?:kayıt|kayit|proses).*eksik/i
      .test(missingCommand)
  ) {

    let productType = '';

    if (/ekşi|eksi|pavlaka/i.test(missingCommand)) {
      productType = 'sour_cream';
    } else if (/peynir|stp/i.test(missingCommand)) {
      productType = 'stp';
    } else if (/tatlı|tatli/i.test(missingCommand)) {
      productType = 'dessert';
    }

    if (!productType) {
      return {
        type: 'question',
        question:
          'Hangi ürünün eksik kayıtlarını görmek istiyorsun?'
      };
    }

    const lookup =
      await callHaccpBridge(
        'get_open_productions',
        {
          product_type: productType
        }
      );

    if (!lookup?.ok) {
      return {
        type: 'lookup_failed',
        message:
          lookup?.error ||
          'Açık üretimler sorgulanamadı.'
      };
    }

    const productions =
      lookup.productions || [];

    if (!productions.length) {
      return {
        type: 'lookup_result',
        message:
          'Bu ürüne ait açık üretim bulunamadı.'
      };
    }

    if (productions.length > 1) {

      const options = productions.map(
        (production, index) =>
          `${index + 1}. ${production.production_date} - ${production.batch_count} batch - ${production.start_time}`
      );

      return {
        type: 'multiple_open_productions',
        message:
          'Birden fazla açık üretim var:\n' +
          options.join('\n') +
          '\nHangi üretimi kontrol edeceğimizi belirt. Kontrol yapılmadı.'
      };
    }

    const production = productions[0];

    const result =
      await callHaccpBridge(
        'get_missing_production_records',
        {
          production_id:
            production.production_id
        }
      );

    if (!result?.ok) {
      return {
        type: 'lookup_failed',
        message:
          result?.error ||
          'Eksik kayıt kontrolü yapılamadı.'
      };
    }

    const missing =
      Array.isArray(result.missing)
        ? result.missing
        : [];

    const details = missing.map(
      item => '- ' + item.process
    );

    const summary =
      `${result.production_date} ${result.product_name}\n` +
      `Toplam proses: ${result.total_processes}\n` +
      `Saat kaydı bulunan: ${result.completed_count}\n` +
      `Saat kaydı eksik: ${result.missing_count}`;

    return {
      type: 'lookup_result',
      message:
        missing.length
          ? summary +
            '\n\nSaat kaydı eksik aşamalar:\n' +
            details.join('\n')
          : summary +
            '\n\nTüm proses saatleri kayıtlı.'
    };
  }
  
// ==========================================================
  // 6.5.5 - PRODUCTION PROCESS RECORDS
  // ==========================================================

  const processCommand =
    normalizeCommandText(text);

  const productMatch = processCommand.match(
    /\b(ekşi|eksi|pavlaka|peynir|stp|tatlı)\b/i
  );

  if (productMatch && !intakeDraft) {

    const productWord =
      productMatch[1].toLowerCase();

    const productType =
      /ekşi|eksi|pavlaka/.test(productWord)
        ? 'sour_cream'
        : /peynir|stp/.test(productWord)
          ? 'stp'
          : 'dessert';

    const productNames = {
      sour_cream: 'Ekşi Krema',
      stp: 'Taze Peynir',
      dessert: 'Sütlü Tatlı'
    };

   const processDefinitions = [
      {
        pattern: /son\s*(?:ısı|isi|ısıl\s*işlem)/i,
        name: 'Son ısıl işlem'
      },
      {
        pattern: /kültür\s*ekleme\s*sıcaklığı|kultur\s*ekleme\s*sicakligi/i,
        name: 'Kültür ekleme sıcaklığına soğutma'
      },
      {
        pattern: /fermantasyon\s*kabinine\s*(?:alma|alındı|alindi|kondu)/i,
        name: 'Fermantasyon kabinine alma'
      },
      {
        pattern: /homojenizasyon|homojenizerden\s*geçti/i,
        name: 'Homojenizasyon ve aynı kazana dönüş'
      },
      {
        pattern: /kültür\s*eklendi|kultur\s*eklendi/i,
        name: 'Kültür ekleme'
      },
      {
        pattern: /dolum\s*(?:başladı|bitti|tamamlandı)|ambalajlara\s*dolum/i,
        name: 'Son ambalajlara dolum'
      },
      {
        pattern: /kapak(?:lar)?\s*(?:kapatıldı|kapandi|kapandı)/i,
        name: 'Kapak kapatma'
      },
      {
        pattern: /tartım\s*(?:bitti|tamamlandı)|kazana\s*alma/i,
        name: 'Tartım ve kazana alma'
      },
      {
        pattern: /(?:ilk\s*)?(?:ısıtma|isitma|pişirme|pisirme)\s*(?:bitti|tamamlandı)/i,
        name: 'İlk ısıtma/pişirme'
      }
    ];

    const definition =
      processDefinitions.find(
        item => item.pattern.test(processCommand)
      );

    // pH kayıtları ayrı ve geçmiş korumalı
    // fonksiyon üzerinden yönetilecek.
    const isPhMessage =
      /\bp\s*h\b/i.test(processCommand);

    if (definition && !isPhMessage) {

      const timeMatch =
        processCommand.match(
          /\b(\d{1,2})[:.](\d{2})\b/
        );

      const measurementTime =
        timeMatch
          ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
          : '';

     const measurement = '';

      if (!measurementTime) {

        return {
          type: 'question',
          question:
            'İşlemin tamamlandığı saati belirt. ' +
            'Örnek: HACCP ekşi homojenizasyon bitti 11:15'
        };
      }

      const hours =
        Number(measurementTime.split(':')[0]);

      const minutes =
        Number(measurementTime.split(':')[1]);

      if (
        hours > 23 ||
        minutes > 59
      ) {

        return {
          type: 'question',
          question:
            'Geçerli bir saat belirt. Örnek: 11:35'
        };
      }

      const lookup =
        await callHaccpBridge(
          'get_open_productions',
          {
            product_type: productType
          }
        );

      if (!lookup?.ok) {

        return {
          type: 'lookup_failed',
          message:
            'Açık üretimler sorgulanamadı.'
        };
      }

      const productions =
        lookup.productions || [];

      if (!productions.length) {

        return {
          type: 'no_open_production',
          message:
            `Açık ${productNames[productType]} üretimi bulunamadı.`
        };
      }

      if (productions.length > 1) {

        const options =
          productions.map(
            (production, index) =>
              `${index + 1}. ${production.production_date} - ${production.batch_count} batch - ${production.start_time}`
          );

        return {
          type: 'multiple_open_productions',
          message:
            'Birden fazla açık üretim var:\n' +
            options.join('\n') +
            '\nİlgili üretimi belirt. Kayıt yapılmadı.'
        };
      }

      const production = productions[0];


        const summary =
        `${production.production_date} ${production.product_name}: ` +
        `${definition.name} tamamlanma saati ${measurementTime} kaydedilecek.`;
      

      const pendingOperation = {
        intent:
          'record_open_production_measurement',

        requires_confirmation: true,
        summary,
        operation_id: randomUUID(),
        actor_id: actorId,
        actor_name: actorName,

        data: {
          production_id:
            production.production_id,

          process:
            definition.name,

          measurement,
          time: measurementTime
        }
      };

      const pendingInterpretation = {
        state_kind: 'confirmation',
        ready: true,
        requires_confirmation: true,
        summary,
        operations: [pendingOperation],
        actor_id: actorId,
        actor_name: actorName
      };

      const saved =
        await persistPendingConfirmation(
          key,
          pendingInterpretation,
          actorId,
          actorName
        );

      if (!saved.ok) {

        return {
          type: 'pending_persistence_failed',
          message:
            'Ölçüm onayı kaydedilemedi. İşlem yapılmadı.'
        };
      }

      pendingConfirmations.set(
        key,
        pendingInterpretation
      );

      return {
        type: 'confirmation_required',
        message: summary + ' Onaylıyor musun?'
      };
    }
  }


  // ----------------------------------------------------------
  // DOLUM BİLGİSİ: AÇIK ÜRETİM / YENİ ÜRETİM SEÇİMİ
  // ----------------------------------------------------------

  const destinationDraft =
    intakeDraft &&
    (
      intakeDraft.await_destination ||
      intakeDraft.await_open_production_choice ||
      isBatchPackagingCandidate(intakeDraft)
    )
      ? intakeDraft
      : null;


  if (destinationDraft) {

    const command =
      normalizeCommandText(text);


    if (
      ['iptal', 'vazgeç', 'vazgec']
        .includes(command)
    ) {

      const cleared =
        await clearPendingConfirmation(key);

      return cleared.ok
        ? {
            type: 'cancelled',
            message: 'Dolum taslağı iptal edildi.'
          }
        : {
            type: 'cancellation_failed',
            message: 'Dolum taslağı iptal edilemedi.'
          };
    }


    if (
      destinationDraft
        .await_open_production_choice
    ) {

      const productions =
        Array.isArray(
          destinationDraft.open_productions
        )
          ? destinationDraft.open_productions
          : [];

      const match =
        command.match(/^(\d+)$/);

      const index =
        match
          ? Number(match[1]) - 1
          : -1;

      if (
        index < 0 ||
        index >= productions.length
      ) {

        const options =
          productions.map(
            (production, i) =>
              `${i + 1}. ${production.product_name} | ${production.production_date} | ${production.batch_count} batch | ${production.start_time}`
          );

        return {
          type: 'question',
          question:
            'Hangi açık üretime bağlayayım?\n' +
            options.join('\n') +
            '\nNumarasını yaz.'
        };
      }

      return queueOpenProductionBatchConfirmation(
        key,
        destinationDraft,
        productions[index],
        actorId,
        actorName
      );
    }


    const chooseOpen =
      command === '1' ||
      /^(?:açık|acik)\s+(?:üretim|uretim)(?:e|ine)?$/i
        .test(command);


    if (chooseOpen) {

      const lookup =
        await callHaccpBridge(
          'get_open_productions',
          {}
        );

      if (!lookup?.ok) {
        return {
          type: 'lookup_failed',
          message:
            lookup?.error ||
            'Açık üretimler sorgulanamadı.'
        };
      }

      const productions =
        Array.isArray(lookup.productions)
          ? lookup.productions
          : [];

      if (!productions.length) {
        return {
          type: 'question',
          question:
            'Açık üretim bulunamadı. Yeni üretim olarak devam etmek için “2” veya “yeni üretim” yaz.'
        };
      }

      if (productions.length === 1) {
        return queueOpenProductionBatchConfirmation(
          key,
          destinationDraft,
          productions[0],
          actorId,
          actorName
        );
      }

      const nextDraft = {
        ...destinationDraft,
        state_kind: 'intake_draft',
        await_destination: false,
        await_open_production_choice: true,
        open_productions: productions,
        actor_id: actorId,
        actor_name: actorName
      };

      const saved =
        await persistPendingConfirmation(
          key,
          nextDraft,
          actorId,
          actorName
        );

      if (!saved.ok) {
        return {
          type: 'pending_persistence_failed',
          message:
            'Açık üretim seçimi kaydedilemedi.'
        };
      }

      pendingConfirmations.set(
        key,
        nextDraft
      );

      const options =
        productions.map(
          (production, i) =>
            `${i + 1}. ${production.product_name} | ${production.production_date} | ${production.batch_count} batch | ${production.start_time}`
        );

      return {
        type: 'question',
        question:
          'Birden fazla açık üretim var:\n' +
          options.join('\n') +
          '\nHangisine bağlayayım? Numarasını yaz.'
      };
    }


    const chooseNew =
      command === '2' ||
      /^yeni\s+(?:üretim|uretim)(?:\s+olarak)?$/i
        .test(command);


    if (chooseNew) {

      const nextDraft = {
        ...destinationDraft,
        state_kind: 'intake_draft',
        await_destination: false,
        await_open_production_choice: false,
        open_productions: [],
        actor_id: actorId,
        actor_name: actorName
      };

      const saved =
        await persistPendingConfirmation(
          key,
          nextDraft,
          actorId,
          actorName
        );

      if (!saved.ok) {
        return {
          type: 'intake_draft_persistence_failed',
          message:
            'Yeni üretim taslağı kaydedilemedi.'
        };
      }

      pendingConfirmations.set(
        key,
        nextDraft
      );

      return {
        type: 'question',
        question:
          'Yeni üretim olarak devam ediyoruz. Ürün tipi, üretim tarihi, ürün adı ve batch adedini belirt.'
      };
    }


    return {
      type: 'question',
      question:
        'Bu dolum bilgisini nereye kaydedeyim?\n' +
        '1. Açık üretime\n' +
        '2. Yeni üretim olarak'
    };
  }

  
  // ----------------------------------------------------------
  // INTERPRET NEW MESSAGE
  // ----------------------------------------------------------

   if (
    intakeDraft &&
    [
      'iptal',
      'vazgeç',
      'vazgec'
    ].includes(
      normalizeCommandText(
        text
      )
    )
  ) {

    const clearDraftResult =
      await clearPendingConfirmation(
        key
      );


    if (!clearDraftResult.ok) {

      return {
        type:
          'intake_draft_cancellation_failed',

        message:
          'Yeni parti taslağı silinemedi.',

        error:
          clearDraftResult.error,

        bridge_result:
          clearDraftResult.bridge_result
      };
    }


    return {
      type:
        'cancelled',

      message:
        'Yeni parti taslağı iptal edildi.'
    };
  }


  const interpretation =
    await interpretHaccpMessage(
      text,
      intakeDraft
    );


if (!interpretation?.ready) {

    if (
      !intakeDraft &&
      isBatchPackagingCandidate(
        interpretation
      )
    ) {

      const destinationDraft = {
        ...interpretation,
        state_kind: 'intake_draft',
        await_destination: true,
        await_open_production_choice: false,
        open_productions: [],
        actor_id: actorId,
        actor_name: actorName
      };

      const draftSaved =
        await persistPendingConfirmation(
          key,
          destinationDraft,
          actorId,
          actorName
        );

      if (!draftSaved.ok) {
        return {
          type:
            'intake_draft_persistence_failed',
          message:
            'Dolum taslağı kaydedilemedi.',
          error:
            draftSaved.error,
          bridge_result:
            draftSaved.bridge_result
        };
      }

      pendingConfirmations.set(
        key,
        destinationDraft
      );

      return {
        type: 'question',
        question:
          'Bu dolum bilgisini nereye kaydedeyim?\n' +
          '1. Açık üretime\n' +
          '2. Yeni üretim olarak'
      };
    }


    const hasIntakeDraft =

  
  Array.isArray(
    interpretation?.operations
  ) &&
  interpretation.operations.some(
    operation =>
      [
        'create_batch',
        'start_production'
      ].includes(
        operation?.intent
      )
  );


if (hasIntakeDraft) {

      const draftInterpretation = {
        ...interpretation,

        state_kind:
          'intake_draft',

        actor_id:
          actorId,

        actor_name:
          actorName
      };


      const draftSaved =
        await persistPendingConfirmation(
          key,
          draftInterpretation,
          actorId,
          actorName
        );


      if (!draftSaved.ok) {

        return {
          type:
            'intake_draft_persistence_failed',

          message:
            'Yeni parti taslağı kalıcı olarak saklanamadı.',

          error:
            draftSaved.error,

          bridge_result:
            draftSaved.bridge_result
        };
      }


      pendingConfirmations.set(
        key,
        draftInterpretation
      );
    }


    return {
      type:
        'question',

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

    state_kind:
      'confirmation',

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


          const reply =
            formatHaccpReply(
              result
            );


          rememberHaccpConversation(
            waId,
            text,
            reply
          );


          return sendJson(
            res,
            200,
            {
              ok: true,

              wa_id:
                waId,

              reply,

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
