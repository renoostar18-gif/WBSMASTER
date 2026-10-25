/**
 * OpenAPI 3.1 description of the public API (spec 7.2), served at /api/openapi.json.
 * The web app uses the same routes with a session cookie; integrations use an API key.
 */
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ content: { 'application/json': { schema } } });
const ok = (schema: object, description = 'OK') => ({ 200: { description, ...json(schema) } });
const created = (schema: object) => ({ 201: { description: 'Created', ...json(schema) } });
const id = (name: string, description: string) => ({ name, in: 'path', required: true, description, schema: { type: 'string', format: 'uuid' } });
const P = id('projectId', 'Project id');
const O = id('orgId', 'Organisation id');
const date = { type: ['string', 'null'], format: 'date' };
const okBody = ok({ type: 'object', properties: { ok: { type: 'boolean' } } });

export const openApi = {
  openapi: '3.1.0',
  info: {
    title: 'WBS Master API',
    version: '1.0.0',
    description: [
      'Read and change projects with the same permissions as the person who made the API key.',
      'Create keys in Settings → API keys (Team and Business plans). Send `Authorization: Bearer <key>`.',
      'A key reaches one organisation; read-only keys can only use GET. Each key may make 300 requests a minute',
      '(`X-RateLimit-Remaining`; `429` with `Retry-After` beyond that).',
      'Dates are ISO `YYYY-MM-DD`. Errors are `{ "error": "<code>" }` with a stable code.',
      '',
      'Webhooks POST `{ id, event, createdAt, orgId, data }` with `X-WBS-Signature: t=<unix seconds>,v1=<hex>`,',
      'where v1 is HMAC-SHA256 of `<t>.<raw body>` with the webhook secret. Reject old `t` values to stop replays.',
      'Failed deliveries are retried after 1, 5, 30, 120 and 720 minutes.',
    ].join('\n'),
  },
  servers: [{ url: '/api' }],
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'wbsm_… API key' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
      Item: {
        type: 'object',
        description: 'A WBS item as stored. Parents roll up dates, progress and health from their children.',
        properties: {
          id: { type: 'string', format: 'uuid' }, parentId: { type: ['string', 'null'], format: 'uuid' },
          name: { type: 'string' }, owner: { type: 'string' },
          status: { enum: ['auto', 'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'] },
          plannedStart: date, plannedFinish: date, forecastStart: date, forecastFinish: date, actualStart: date, actualFinish: date,
          progress: { type: 'number', minimum: 0, maximum: 100 }, notes: { type: 'string' },
          deps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, lag: { type: 'integer' } } } },
        },
      },
      Computed: {
        type: 'object',
        description: 'Calculated values per item id: WBS code, level, rolled-up dates, status, progress, planned %, variance (working days), health and its reason.',
        additionalProperties: true,
      },
      Op: {
        description: 'One edit. A batch is applied all or nothing, then linked work is auto-scheduled.',
        oneOf: [
          { type: 'object', required: ['op', 'parentId'], properties: { op: { const: 'add' }, id: { type: 'string', format: 'uuid' }, parentId: { type: ['string', 'null'] }, afterId: { type: ['string', 'null'] }, values: { type: 'object' } } },
          { type: 'object', required: ['op', 'id', 'field', 'value'], properties: { op: { const: 'set' }, id: { type: 'string' }, field: { type: 'string' }, value: {} } },
          { type: 'object', required: ['op', 'id', 'parentId', 'index'], properties: { op: { const: 'move' }, id: { type: 'string' }, parentId: { type: ['string', 'null'] }, index: { type: 'integer' } } },
          { type: 'object', required: ['op', 'id'], properties: { op: { const: 'delete' }, id: { type: 'string' } } },
          { type: 'object', required: ['op', 'id', 'values'], properties: { op: { const: 'put' }, id: { type: 'string' }, values: { type: 'object' } } },
          { type: 'object', required: ['op', 'succ', 'pred'], properties: { op: { const: 'link' }, succ: { type: 'string' }, pred: { type: 'string' }, lag: { type: 'integer' } } },
          { type: 'object', required: ['op', 'succ', 'pred'], properties: { op: { const: 'unlink' }, succ: { type: 'string' }, pred: { type: 'string' } } },
        ],
      },
      WebhookEvent: { enum: ['item.changed', 'health.changed', 'baseline.saved', 'project.created'] },
    },
    responses: {
      Error: { description: 'Error', ...json(ref('Error')) },
    },
  },
  paths: {
    '/me': { get: { summary: 'The key’s owner and their organisations', responses: ok({ type: 'object' }) } },
    '/orgs/{orgId}/projects': {
      parameters: [O],
      get: { summary: 'Projects the person can see', parameters: [{ name: 'archived', in: 'query', schema: { type: 'string' }, description: 'Any value: archived projects instead' }],
        responses: ok({ type: 'object', properties: { projects: { type: 'array', items: { type: 'object' } } } }) },
      post: { summary: 'Create a project', requestBody: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, locale: { enum: ['en', 'ar'] } } }),
        responses: created({ type: 'object', properties: { id: { type: 'string', format: 'uuid' } } }) },
    },
    '/projects/{projectId}': {
      parameters: [P],
      get: { summary: 'A project: settings, items, baselines, calendar, summary text and calculations',
        responses: ok({ type: 'object', properties: { items: { type: 'array', items: ref('Item') }, computed: ref('Computed') } }) },
      patch: { summary: 'Project settings (project admins)', requestBody: json({ type: 'object', properties: {
        name: { type: 'string' }, statusDate: date, redThresholdDays: { type: 'integer' }, autoSchedule: { type: 'boolean' },
        activeBaselineId: { type: ['string', 'null'] }, calendarId: { type: ['string', 'null'] }, archived: { type: 'boolean' } } }), responses: okBody },
      delete: { summary: 'Delete a project (project admins)', responses: okBody },
    },
    '/projects/{projectId}/ops': {
      parameters: [P],
      post: { summary: 'Apply a batch of edits (editors)', requestBody: json({ type: 'object', required: ['ops'], properties: { ops: { type: 'array', maxItems: 500, items: ref('Op') } } }),
        responses: { ...ok({ type: 'object', properties: { version: { type: 'integer' }, items: { type: 'array', items: ref('Item') }, computed: ref('Computed'), scheduled: { type: 'array', items: { type: 'string' } }, ignoredDeps: { type: 'array', items: { type: 'string' } } } }),
          400: { $ref: '#/components/responses/Error' } } },
    },
    '/projects/{projectId}/baselines': {
      parameters: [P],
      post: { summary: 'Save a baseline (project admins)', requestBody: json({ type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } } }),
        responses: created({ type: 'object' }) },
    },
    '/projects/{projectId}/summary': {
      parameters: [P],
      put: { summary: 'Report text (editors)', requestBody: json({ type: 'object', properties: Object.fromEntries(['narrative', 'achievements', 'nextSteps', 'risks', 'decisions'].map(k => [k, { type: 'string' }])) }), responses: okBody },
    },
    '/projects/{projectId}/activity': {
      parameters: [P],
      get: { summary: 'Change history, newest first (100 at a time)', parameters: [{ name: 'before', in: 'query', schema: { type: 'integer' } }, { name: 'itemId', in: 'query', schema: { type: 'string' } }], responses: ok({ type: 'object' }) },
    },
    '/projects/{projectId}/comments': {
      parameters: [P],
      get: { summary: 'Comments, oldest first', responses: ok({ type: 'object' }) },
      post: { summary: 'Comment on the project or an item, or reply (commenters)', requestBody: json({ type: 'object', required: ['body'], properties: { body: { type: 'string' }, itemId: { type: ['string', 'null'] }, parentId: { type: ['string', 'null'] }, mentions: { type: 'array', items: { type: 'string', format: 'uuid' } } } }),
        responses: created({ type: 'object' }) },
    },
    '/orgs/{orgId}/portfolio': {
      parameters: [O],
      get: { summary: 'Every project the person can see, worst first', parameters: [{ name: 'asOf', in: 'query', schema: { type: 'string', format: 'date' } }], responses: ok({ type: 'object' }) },
    },
    '/orgs/{orgId}/webhooks': {
      parameters: [O],
      get: { summary: 'Webhooks (organisation admins)', responses: ok({ type: 'object' }) },
      post: { summary: 'Add a webhook; the response holds its signing secret, shown once', requestBody: json({ type: 'object', required: ['url', 'events'], properties: { url: { type: 'string', format: 'uri' }, events: { type: 'array', items: ref('WebhookEvent') }, active: { type: 'boolean' } } }),
        responses: created({ type: 'object', properties: { id: { type: 'string' }, secret: { type: 'string' } } }) },
    },
    '/orgs/{orgId}/webhooks/{webhookId}': {
      parameters: [O, id('webhookId', 'Webhook id')],
      patch: { summary: 'Change a webhook', requestBody: json({ type: 'object' }), responses: okBody },
      delete: { summary: 'Remove a webhook', responses: okBody },
    },
    '/orgs/{orgId}/webhooks/{webhookId}/test': { parameters: [O, id('webhookId', 'Webhook id')], post: { summary: 'Send a ping', responses: okBody } },
    '/orgs/{orgId}/webhooks/{webhookId}/deliveries': { parameters: [O, id('webhookId', 'Webhook id')], get: { summary: 'Recent deliveries', responses: ok({ type: 'object' }) } },
  },
} as const;
