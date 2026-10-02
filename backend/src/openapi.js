// OpenAPI 3.0 specification for QualChek API.
//
// Hand-maintained: it is not generated from the routes, so when you add or
// change an endpoint, update it here too. The Swagger UI at /api/docs reads
// this object directly.

const bearer = [{ BearerAuth: [] }];
const apiKey = [{ ApiKeyAuth: [] }];

// Reused response bodies.
const err = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});
const json = (description, schema) => ({
  description,
  content: { 'application/json': { schema } },
});
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (name) => ({ type: 'array', items: ref(name) });
const body = (schema, required = true) => ({
  required,
  content: { 'application/json': { schema } },
});

// Reused path parameters.
const pathParam = (name, description) => ({
  name, in: 'path', required: true, schema: { type: 'string' }, description,
});
const projectId = pathParam('projectId', 'Project id');

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'QualChek API',
    description: [
      'REST API for QualChek: projects, test cases, test runs, reports,',
      'CI integration, web crawling and Jira integration.',
      '',
      '## Authentication',
      '',
      'Every endpoint requires a **Bearer JWT** except `POST /auth/login`,',
      '`POST /auth/forgot-password`, and the two link endpoints',
      '(`GET /auth/invite/verify`, `POST /auth/invite/accept`), which are reached by',
      'someone who is not signed in.',
      '',
      'Obtain a token with `POST /auth/login`, then send `Authorization: Bearer <token>`.',
      'Access tokens last 15 minutes. When one expires, `POST /auth/refresh` issues another',
      'using the httpOnly `tm_rt` cookie set at login — the browser attaches it by itself, and',
      'JavaScript cannot read it. The cookie is session-scoped, so it dies with the browser.',
      '',
      'Refresh tokens are single-use: every refresh rotates the cookie, and replaying a spent',
      'token revokes the whole session family. `POST /auth/logout` revokes the session outright,',
      'as does changing a password — which is the way to end a session that may have leaked.',
      '',
      'The `/ci/*` endpoints use a long-lived **API key** instead, sent as `X-API-Key`.',
      'They are meant for build pipelines, where an expiring token is not practical.',
      '',
      '## Accounts',
      '',
      'Accounts are created by invitation. An admin creates the user with',
      '`POST /auth/register`; the user receives an emailed link and sets their own',
      'password via `POST /auth/invite/accept`. **Admins never set passwords.**',
      'Invite links are single-use and expire in 1 hour.',
      '',
      '## Roles',
      '',
      '- **admin** — full access; manage users, projects and settings',
      '- **tester** — create and edit test cases, execute runs, view reports;',
      '  restricted to the projects they are assigned to',
      '- **viewer** — read-only across all projects',
      '',
      'A **super admin** is an admin with `is_super_admin: true`. It is a flag, not a',
      'fourth role. Only a super admin may edit or delete another admin, and the last',
      'active super admin cannot be demoted or deactivated.',
    ].join('\n'),
    version: '1.1.0',
    contact: { name: 'QualChek' },
  },
  servers: [
    { url: 'https://test-manager-five.vercel.app/api', description: 'Production' },
    { url: 'http://localhost:3001/api', description: 'Local development (API only; the UI runs on :3100)' },
  ],
  tags: [
    { name: 'Auth', description: 'Login, the invite flow, and the current user' },
    { name: 'Users', description: 'User administration, project access and audit trail' },
    { name: 'Projects', description: 'Projects and their members' },
    { name: 'Suites', description: 'Test suites (folders)' },
    { name: 'Test Cases', description: 'Test case CRUD and comments' },
    { name: 'Test Runs', description: 'Run creation, execution and results' },
    { name: 'Reports', description: 'Analytics and reporting' },
    { name: 'Jira', description: 'Jira configuration, issue links, and comments' },
    { name: 'CI', description: 'Pipeline endpoints, authenticated with X-API-Key' },
    { name: 'Crawler', description: 'Web crawling and browser recording' },
    { name: 'Scripts', description: 'Automation script export' },
    { name: 'System', description: 'Health and maintenance' },
  ],

  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
        description: 'JWT from POST /auth/login.',
      },
      ApiKeyAuth: {
        type: 'apiKey', in: 'header', name: 'X-API-Key',
        description: 'Long-lived key for CI pipelines. Manage it at /auth/api-key.',
      },
    },

    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Unauthorized' } },
      },
      Success: {
        type: 'object',
        properties: { success: { type: 'boolean', example: true } },
      },

      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Jane Doe' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'tester', 'viewer'] },
          is_active: {
            type: 'boolean',
            description: 'Deactivated users cannot log in, accept an invite, or use an API key.',
          },
          is_super_admin: {
            type: 'boolean',
            description: 'May edit and delete other admins. The last active one cannot be demoted.',
          },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          user: ref('User'),
          token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
        },
      },
      AuditEntry: {
        type: 'object',
        description:
          'Actor and target are denormalised so history survives the deletion of either.',
        properties: {
          id: { type: 'string' },
          at: { type: 'string', format: 'date-time' },
          actor_id: { type: 'string', nullable: true },
          actor_name: { type: 'string', nullable: true },
          actor_email: { type: 'string', nullable: true },
          action: { type: 'string', example: 'user.deactivated' },
          target_type: { type: 'string', nullable: true, example: 'user' },
          target_id: { type: 'string', nullable: true },
          target_label: { type: 'string', nullable: true },
          detail: { type: 'string', nullable: true },
          ip: { type: 'string', nullable: true },
        },
      },

      Project: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'E-Commerce Tests' },
          description: { type: 'string', nullable: true },
          created_by: { type: 'string', format: 'uuid' },
          creator_name: { type: 'string' },
          test_case_count: { type: 'integer' },
          test_run_count: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Suite: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          project_id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Login Tests' },
          description: { type: 'string', nullable: true },
          parent_id: { type: 'string', nullable: true },
          test_case_count: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      TestStep: {
        type: 'object',
        properties: {
          action: { type: 'string', example: 'Enter username and password' },
          expected: { type: 'string', example: 'Login button becomes active' },
        },
      },
      TestCase: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          suite_id: { type: 'string', nullable: true },
          suite_name: { type: 'string', nullable: true },
          project_id: { type: 'string', format: 'uuid' },
          title: { type: 'string', example: 'Verify successful login' },
          description: { type: 'string', nullable: true },
          preconditions: { type: 'string', nullable: true },
          steps: arrayOf('TestStep'),
          expected_result: { type: 'string', nullable: true },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          status: { type: 'string', enum: ['active', 'draft', 'deprecated'] },
          tags: { type: 'array', items: { type: 'string' } },
          automation_status: { type: 'string', enum: ['manual', 'automated'] },
          automation_framework: { type: 'string', nullable: true },
          script_path: { type: 'string', nullable: true },
          created_by: { type: 'string', format: 'uuid' },
          creator_name: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Comment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          entity_type: { type: 'string', example: 'test_case' },
          entity_id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          user_name: { type: 'string' },
          content: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          jira: {
            nullable: true,
            description: [
              'Present only when send_to_jira was true. The comment is saved before',
              'Jira is contacted, so a Jira failure is reported here rather than',
              'failing the request.',
            ].join(' '),
            oneOf: [
              {
                type: 'object',
                properties: {
                  key: { type: 'string', example: 'KAN-6' },
                  url: { type: 'string', format: 'uri' },
                },
              },
              {
                type: 'object',
                properties: { error: { type: 'string', example: 'This test case is not linked to a Jira issue' } },
              },
            ],
          },
        },
      },

      TestRun: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          project_id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Sprint 12 Regression' },
          description: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          build_version: { type: 'string', nullable: true },
          environment: { type: 'string', nullable: true },
          created_by: { type: 'string', format: 'uuid' },
          creator_name: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          completed_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      TestRunItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          run_id: { type: 'string', format: 'uuid' },
          test_case_id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'passed', 'failed', 'blocked', 'skipped'] },
          notes: { type: 'string', nullable: true },
          duration: { type: 'integer', nullable: true, description: 'Seconds' },
          executed_by: { type: 'string', nullable: true },
          executed_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },

      JiraConfig: {
        type: 'object',
        properties: {
          configured: { type: 'boolean' },
          base_url: { type: 'string', example: 'https://your-site.atlassian.net' },
          email: { type: 'string', format: 'email' },
          api_token: { type: 'string', example: '••••••••', description: 'Always masked on read.' },
          default_project: { type: 'string', example: 'KAN' },
        },
      },
      JiraIssue: {
        type: 'object',
        properties: {
          key: { type: 'string', example: 'KAN-6' },
          summary: { type: 'string' },
          status: { type: 'string', example: 'To Do' },
          statusCategory: { type: 'string', example: 'blue-gray' },
          priority: { type: 'string', nullable: true },
          assignee: { type: 'string', nullable: true },
          issueType: { type: 'string', example: 'Task' },
          url: { type: 'string', format: 'uri' },
        },
      },
    },
  },

  security: bearer,

  paths: {
    // ---------------------------------------------------------------- Auth
    '/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Log in', security: [],
        requestBody: body({
          type: 'object', required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', format: 'password' },
          },
        }),
        responses: {
          200: json('Signed in. Also sets the httpOnly refresh cookie.', ref('AuthResponse')),
          401: err('Invalid credentials'),
          403: err('Account deactivated'),
        },
      },
    },

    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange the refresh cookie for a new access token',
        description:
          'Sends no body and takes no Authorization header: the httpOnly `tm_rt` cookie is the '
          + 'credential, and the browser attaches it automatically. Each call rotates the cookie, '
          + 'so a refresh token works exactly once. Presenting a spent one revokes every session '
          + 'in its rotation family, on the assumption that two parties now hold it.',
        security: [],
        responses: {
          200: json('New access token, and a rotated refresh cookie', ref('AuthResponse')),
          401: err('No session — missing, expired, revoked or replayed'),
        },
      },
    },

    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Sign out',
        description:
          'Revokes this session server-side and clears the refresh cookie. The access token is '
          + 'not revocable and stays valid for the remainder of its 15 minutes.',
        security: [],
        responses: { 200: json('Signed out', { type: 'object', properties: { ok: { type: 'boolean' } } }) },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Users'],
        summary: 'Create a user (admin only)',
        description: [
          'Creates the account and emails an invite link so the user can set their',
          'own password. Despite the name this is **not** public registration:',
          'it requires an authenticated admin.',
        ].join(' '),
        requestBody: body({
          type: 'object', required: ['name', 'email'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'tester', 'viewer'], default: 'tester' },
            password: {
              type: 'string', format: 'password',
              description: 'Optional and discouraged. Omit it so the user sets their own.',
            },
          },
        }),
        responses: {
          201: json('Created', { type: 'object', properties: { user: ref('User'), invited: { type: 'boolean' } } }),
          400: err('Invalid email, or the address is already in use'),
          403: err('Not an admin'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'], summary: 'The signed-in user',
        responses: { 200: json('Current user', ref('User')), 401: err('Unauthenticated') },
      },
    },
    '/auth/me/password': {
      put: {
        tags: ['Auth'], summary: 'Change your own password (super admin only)',
        description: [
          'Available only to super admins; other users set a password through an invite',
          'link and get a new one by having an admin resend the invite. The current',
          'password must be supplied. Changing it also invalidates any outstanding',
          'invite link for the account.',
        ].join(' '),
        requestBody: body({
          type: 'object', required: ['current_password', 'new_password'],
          properties: {
            current_password: { type: 'string', format: 'password' },
            new_password: { type: 'string', format: 'password', minLength: 8 },
          },
        }),
        responses: {
          200: json('Changed', ref('Success')),
          400: err('Current password incorrect, new password too short, or unchanged'),
          403: err('Not a super admin'),
        },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'], summary: 'Request a password reset link', security: [],
        description: [
          'Emails a single-use link, valid for 1 hour, to the address if an active',
          'account exists for it. The response is identical either way, so it cannot',
          'be used to discover which addresses have accounts.',
        ].join(' '),
        requestBody: body({
          type: 'object', required: ['email'],
          properties: { email: { type: 'string', format: 'email' } },
        }),
        responses: {
          200: json('Always', {
            type: 'object',
            properties: { success: { type: 'boolean' }, message: { type: 'string' } },
          }),
        },
      },
    },
    '/auth/invite/verify': {
      get: {
        tags: ['Auth'], summary: 'Check an invite link', security: [],
        parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          200: json('Valid', {
            type: 'object',
            properties: {
              valid: { type: 'boolean' },
              name: { type: 'string' },
              email: { type: 'string' },
              mode: { type: 'string', enum: ['invite', 'reset'], description: 'Which flow issued the link' },
            },
          }),
          400: err('Expired, already used, or the account is deactivated'),
        },
      },
    },
    '/auth/invite/accept': {
      post: {
        tags: ['Auth'], summary: 'Set a password from an invite', security: [],
        description:
          'Single-use: the token is signed with the current password hash, so setting a password invalidates it.',
        requestBody: body({
          type: 'object', required: ['token', 'password'],
          properties: { token: { type: 'string' }, password: { type: 'string', format: 'password' } },
        }),
        responses: {
          200: json('Password set; returns a session', ref('AuthResponse')),
          400: err('Expired, already used, or password too weak'),
        },
      },
    },

    // --------------------------------------------------------------- Users
    '/auth/users': {
      get: {
        tags: ['Users'], summary: 'List users',
        responses: { 200: json('Users', arrayOf('User')), 403: err('Insufficient permissions') },
      },
    },
    '/auth/users/{id}': {
      parameters: [pathParam('id', 'User id')],
      put: {
        tags: ['Users'], summary: 'Update a user',
        description: [
          'Roles are locked in two cases: you cannot change your own role, and a',
          "super admin's role cannot change until the flag is removed.",
        ].join(' '),
        requestBody: body({
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'tester', 'viewer'] },
            password: { type: 'string', format: 'password', description: 'Discouraged; users set their own.' },
          },
        }),
        responses: {
          200: json('Updated', { type: 'object', properties: { user: ref('User') } }),
          400: err('Remove super admin status before changing this role'),
          403: err('Not permitted to edit this user, or changing your own role'),
        },
      },
      delete: {
        tags: ['Users'], summary: 'Delete a user',
        responses: {
          200: json('Deleted', ref('Success')),
          403: err('Only a super admin may delete another admin'),
        },
      },
    },
    '/auth/users/{id}/active': {
      parameters: [pathParam('id', 'User id')],
      put: {
        tags: ['Users'], summary: 'Activate or deactivate',
        description: 'Checked on every request, so deactivating ends the session immediately.',
        requestBody: body({
          type: 'object',
          properties: { active: { type: 'boolean', default: true, description: 'false deactivates' } },
        }),
        responses: {
          200: json('Changed', {
            type: 'object',
            properties: { success: { type: 'boolean' }, id: { type: 'string' }, is_active: { type: 'boolean' } },
          }),
          400: err('Cannot deactivate the last active super admin'),
          403: err('Insufficient permissions'),
        },
      },
    },
    '/auth/users/{id}/super-admin': {
      parameters: [pathParam('id', 'User id')],
      put: {
        tags: ['Users'], summary: 'Grant or revoke super admin',
        description: 'Reversible. Only an existing super admin may call it, and only on an admin.',
        requestBody: body({
          type: 'object',
          properties: { super: { type: 'boolean', default: true, description: 'false revokes' } },
        }),
        responses: {
          200: json('Changed', {
            type: 'object',
            properties: { success: { type: 'boolean' }, id: { type: 'string' }, is_super_admin: { type: 'boolean' } },
          }),
          400: err('Target is not an admin, or this is the last active super admin'),
          403: err('Caller is not a super admin'),
        },
      },
    },
    '/auth/users/{id}/invite': {
      parameters: [pathParam('id', 'User id')],
      post: {
        tags: ['Users'], summary: 'Send or resend an invite',
        description: 'Emails a fresh single-use link, valid for 1 hour. Any previous link stops working.',
        responses: {
          200: json('Sent', { type: 'object', properties: { success: { type: 'boolean' }, sent: { type: 'boolean' } } }),
          400: err('Account is deactivated'),
          403: err('Insufficient permissions'),
        },
      },
    },
    '/auth/users/{id}/projects': {
      parameters: [pathParam('id', 'User id')],
      get: {
        tags: ['Users'], summary: 'Projects this user can access',
        description: 'Testers are limited to assigned projects; admins and viewers see all.',
        responses: { 200: json('Project ids', { type: 'array', items: { type: 'string' } }) },
      },
    },
    '/auth/users/{id}/projects/{projectId}': {
      parameters: [pathParam('id', 'User id'), projectId],
      put: {
        tags: ['Users'], summary: 'Grant or revoke project access',
        requestBody: body({
          type: 'object', required: ['action'],
          properties: {
            action: { type: 'string', enum: ['add', 'remove'] },
            role: { type: 'string', enum: ['admin', 'tester', 'viewer'], default: 'tester' },
          },
        }),
        responses: { 200: json('Changed', ref('Success')), 403: err('Insufficient permissions') },
      },
    },
    '/auth/audit': {
      get: {
        tags: ['Users'], summary: 'Audit trail',
        description: 'Sign-ins, user management and destructive data actions. Readable by any admin.',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'action', in: 'query', schema: { type: 'string' }, description: 'Exact action name' },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Match actor name, email or target' },
        ],
        responses: { 200: json('Entries', arrayOf('AuditEntry')), 403: err('Admins only') },
      },
    },
    '/auth/api-key': {
      get: {
        tags: ['Users'], summary: 'Show your CI API key',
        responses: { 200: json('Key, or null if none', { type: 'object', properties: { api_key: { type: 'string', nullable: true } } }) },
      },
      post: {
        tags: ['Users'], summary: 'Generate or regenerate your API key',
        description: 'Regenerating invalidates the previous key immediately.',
        responses: { 200: json('New key', { type: 'object', properties: { api_key: { type: 'string' } } }) },
      },
      delete: {
        tags: ['Users'], summary: 'Revoke your API key',
        responses: { 200: json('Revoked', ref('Success')) },
      },
    },

    // ------------------------------------------------------------ Projects
    '/projects': {
      get: {
        tags: ['Projects'], summary: 'List projects',
        responses: { 200: json('Projects', arrayOf('Project')) },
      },
      post: {
        tags: ['Projects'], summary: 'Create a project',
        requestBody: body({
          type: 'object', required: ['name'],
          properties: { name: { type: 'string' }, description: { type: 'string' } },
        }),
        responses: { 201: json('Created', ref('Project')), 403: err('Insufficient permissions') },
      },
    },
    '/projects/{projectId}': {
      parameters: [projectId],
      get: { tags: ['Projects'], summary: 'Get a project', responses: { 200: json('Project', ref('Project')), 404: err('Not found') } },
      put: {
        tags: ['Projects'], summary: 'Update a project',
        requestBody: body({ type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } }),
        responses: { 200: json('Updated', ref('Project')) },
      },
      delete: { tags: ['Projects'], summary: 'Delete a project', responses: { 200: json('Deleted', ref('Success')) } },
    },
    '/projects/{projectId}/members': {
      parameters: [projectId],
      post: {
        tags: ['Projects'], summary: 'Add a member',
        requestBody: body({
          type: 'object', required: ['user_id'],
          properties: {
            user_id: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['admin', 'tester', 'viewer'], default: 'tester' },
          },
        }),
        responses: { 201: json('Added', ref('Success')) },
      },
    },
    '/projects/{projectId}/members/{userId}': {
      parameters: [projectId, pathParam('userId', 'User id')],
      delete: { tags: ['Projects'], summary: 'Remove a member', responses: { 200: json('Removed', ref('Success')) } },
    },

    // -------------------------------------------------------------- Suites
    '/projects/{projectId}/suites': {
      parameters: [projectId],
      get: { tags: ['Suites'], summary: 'List suites', responses: { 200: json('Suites', arrayOf('Suite')) } },
      post: {
        tags: ['Suites'], summary: 'Create a suite',
        requestBody: body({
          type: 'object', required: ['name'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            parent_id: { type: 'string', nullable: true, description: 'Nest under another suite' },
          },
        }),
        responses: { 201: json('Created', ref('Suite')) },
      },
    },
    '/projects/{projectId}/suites/{id}': {
      parameters: [projectId, pathParam('id', 'Suite id')],
      put: {
        tags: ['Suites'], summary: 'Update a suite',
        requestBody: body({
          type: 'object',
          properties: { name: { type: 'string' }, description: { type: 'string' }, parent_id: { type: 'string', nullable: true } },
        }),
        responses: { 200: json('Updated', ref('Suite')) },
      },
      delete: { tags: ['Suites'], summary: 'Delete a suite', responses: { 200: json('Deleted', ref('Success')) } },
    },

    // ---------------------------------------------------------- Test Cases
    '/projects/{projectId}/test-cases': {
      parameters: [projectId],
      get: {
        tags: ['Test Cases'], summary: 'List test cases',
        parameters: [
          { name: 'suite_id', in: 'query', schema: { type: 'string' } },
          { name: 'priority', in: 'query', schema: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'draft', 'deprecated'] } },
          { name: 'automation_status', in: 'query', schema: { type: 'string', enum: ['manual', 'automated'] } },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Match the title' },
        ],
        responses: { 200: json('Test cases', arrayOf('TestCase')) },
      },
      post: {
        tags: ['Test Cases'], summary: 'Create a test case',
        requestBody: body({
          type: 'object', required: ['title'],
          properties: {
            title: { type: 'string' },
            suite_id: { type: 'string', nullable: true },
            description: { type: 'string' },
            preconditions: { type: 'string' },
            steps: arrayOf('TestStep'),
            expected_result: { type: 'string' },
            priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], default: 'medium' },
            tags: { type: 'array', items: { type: 'string' } },
            automation_status: { type: 'string', enum: ['manual', 'automated'], default: 'manual' },
            automation_framework: { type: 'string' },
            script_path: { type: 'string' },
          },
        }),
        responses: { 201: json('Created', ref('TestCase')) },
      },
      delete: {
        tags: ['Test Cases'], summary: 'Delete several test cases',
        requestBody: body({
          type: 'object', required: ['ids'],
          properties: { ids: { type: 'array', items: { type: 'string', format: 'uuid' } } },
        }),
        responses: { 200: json('Deleted', { type: 'object', properties: { success: { type: 'boolean' }, deleted: { type: 'integer' } } }) },
      },
    },
    '/projects/{projectId}/test-cases/{id}': {
      parameters: [projectId, pathParam('id', 'Test case id')],
      get: {
        tags: ['Test Cases'], summary: 'Get a test case',
        description: 'Includes its comments.',
        responses: { 200: json('Test case', ref('TestCase')), 404: err('Not found') },
      },
      put: {
        tags: ['Test Cases'], summary: 'Update a test case',
        requestBody: body(ref('TestCase')),
        responses: { 200: json('Updated', ref('TestCase')) },
      },
      delete: { tags: ['Test Cases'], summary: 'Delete a test case', responses: { 200: json('Deleted', ref('Success')) } },
    },
    '/projects/{projectId}/test-cases/{id}/comments': {
      parameters: [projectId, pathParam('id', 'Test case id')],
      post: {
        tags: ['Test Cases'], summary: 'Add a comment',
        description: [
          "Comments live in QualChek's own thread. Set `send_to_jira` to also post",
          'the comment on the linked Jira issue; the reply then carries a `jira` field',
          'saying what happened. The comment is saved first, so a Jira failure is',
          'reported without losing it.',
        ].join(' '),
        requestBody: body({
          type: 'object', required: ['content'],
          properties: {
            content: { type: 'string' },
            send_to_jira: {
              type: 'boolean', default: false,
              description: 'Requires the test case to be linked to a Jira issue.',
            },
          },
        }),
        responses: { 201: json('Created', ref('Comment')), 400: err('content is required') },
      },
    },

    // ----------------------------------------------------------- Test Runs
    '/projects/{projectId}/runs': {
      parameters: [projectId],
      get: { tags: ['Test Runs'], summary: 'List runs', responses: { 200: json('Runs', arrayOf('TestRun')) } },
      post: {
        tags: ['Test Runs'], summary: 'Create a run',
        requestBody: body({
          type: 'object', required: ['name'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            build_version: { type: 'string' },
            environment: { type: 'string', example: 'staging' },
            test_case_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
        }),
        responses: { 201: json('Created', ref('TestRun')) },
      },
    },
    '/projects/{projectId}/runs/{runId}': {
      parameters: [projectId, pathParam('runId', 'Run id')],
      get: {
        tags: ['Test Runs'], summary: 'Get a run',
        description: 'Includes its items.',
        responses: { 200: json('Run', ref('TestRun')), 404: err('Not found') },
      },
      put: {
        tags: ['Test Runs'], summary: 'Update a run',
        requestBody: body({
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
        }),
        responses: { 200: json('Updated', ref('TestRun')) },
      },
      delete: { tags: ['Test Runs'], summary: 'Delete a run', responses: { 200: json('Deleted', ref('Success')) } },
    },
    '/projects/{projectId}/runs/{runId}/items/{itemId}': {
      parameters: [projectId, pathParam('runId', 'Run id'), pathParam('itemId', 'Run item id')],
      put: {
        tags: ['Test Runs'], summary: 'Record a result',
        requestBody: body({
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'passed', 'failed', 'blocked', 'skipped'] },
            notes: { type: 'string' },
            duration: { type: 'integer', description: 'Seconds' },
          },
        }),
        responses: { 200: json('Recorded', ref('TestRunItem')) },
      },
    },
    '/projects/{projectId}/runs/{runId}/add-cases': {
      parameters: [projectId, pathParam('runId', 'Run id')],
      post: {
        tags: ['Test Runs'], summary: 'Add test cases to a run',
        requestBody: body({
          type: 'object', required: ['test_case_ids'],
          properties: { test_case_ids: { type: 'array', items: { type: 'string', format: 'uuid' } } },
        }),
        responses: { 200: json('Added', { type: 'object', properties: { success: { type: 'boolean' }, added: { type: 'integer' } } }) },
      },
    },
    '/projects/{projectId}/runs/{runId}/complete': {
      parameters: [projectId, pathParam('runId', 'Run id')],
      post: {
        tags: ['Test Runs'], summary: 'Mark a run complete',
        responses: { 200: json('Completed', ref('TestRun')) },
      },
    },
    '/projects/{projectId}/runs/{runId}/retest': {
      parameters: [projectId, pathParam('runId', 'Run id')],
      post: {
        tags: ['Test Runs'], summary: 'Create a follow-up run',
        description: 'Copies the failed and blocked items of this run into a new one.',
        requestBody: body({
          type: 'object',
          properties: {
            name: { type: 'string' },
            build_version: { type: 'string' },
            environment: { type: 'string' },
          },
        }, false),
        responses: { 201: json('Created', ref('TestRun')) },
      },
    },
    '/projects/{projectId}/runs/{runId}/import-results': {
      parameters: [projectId, pathParam('runId', 'Run id')],
      post: {
        tags: ['Test Runs'], summary: 'Import JUnit XML results',
        description: 'Matches test cases by title and records their outcomes.',
        requestBody: body({
          type: 'object', required: ['xml'],
          properties: { xml: { type: 'string', description: 'JUnit XML document' } },
        }),
        responses: {
          200: json('Imported', {
            type: 'object',
            properties: { matched: { type: 'integer' }, unmatched: { type: 'array', items: { type: 'string' } } },
          }),
          400: err('Malformed XML'),
        },
      },
    },

    // ------------------------------------------------------------- Reports
    '/projects/{projectId}/reports/summary': {
      parameters: [projectId],
      get: {
        tags: ['Reports'], summary: 'Project summary',
        responses: {
          200: json('Summary', {
            type: 'object',
            properties: {
              total_cases: { type: 'integer' },
              total_runs: { type: 'integer' },
              pass_rate: { type: 'number', format: 'float' },
              by_priority: { type: 'object', additionalProperties: { type: 'integer' } },
              by_status: { type: 'object', additionalProperties: { type: 'integer' } },
            },
          }),
        },
      },
    },
    '/projects/{projectId}/reports/run/{runId}': {
      parameters: [projectId, pathParam('runId', 'Run id')],
      get: {
        tags: ['Reports'], summary: 'Run report',
        responses: {
          200: json('Report', {
            type: 'object',
            properties: {
              run: ref('TestRun'),
              total: { type: 'integer' },
              passed: { type: 'integer' },
              failed: { type: 'integer' },
              blocked: { type: 'integer' },
              pass_rate: { type: 'number', format: 'float' },
            },
          }),
        },
      },
    },

    // ---------------------------------------------------------------- Jira
    '/jira/config': {
      get: {
        tags: ['Jira'], summary: 'Get the Jira configuration',
        description: 'The API token is always returned masked.',
        responses: { 200: json('Configuration', ref('JiraConfig')) },
      },
      post: {
        tags: ['Jira'], summary: 'Save the Jira configuration',
        requestBody: body({
          type: 'object', required: ['base_url', 'email', 'api_token'],
          properties: {
            base_url: { type: 'string', example: 'https://your-site.atlassian.net' },
            email: { type: 'string', format: 'email', description: 'The Atlassian account the token belongs to' },
            api_token: {
              type: 'string',
              description: 'An Atlassian API token (starts with ATATT), not your site URL or password.',
            },
            default_project: { type: 'string', example: 'KAN' },
          },
        }),
        responses: { 200: json('Saved', ref('Success')), 403: err('Admins only') },
      },
    },
    '/jira/config/test': {
      post: {
        tags: ['Jira'], summary: 'Test the connection',
        description: 'Succeeds only when Jira returns a real account id; a reachable site alone is not enough.',
        requestBody: body({
          type: 'object',
          properties: {
            base_url: { type: 'string' },
            email: { type: 'string', format: 'email' },
            api_token: { type: 'string' },
          },
        }, false),
        responses: {
          200: json('Connected', {
            type: 'object',
            properties: { success: { type: 'boolean' }, user: { type: 'string' }, accountId: { type: 'string' } },
          }),
          400: err('Credentials not recognised'),
        },
      },
    },
    '/jira/projects': {
      get: {
        tags: ['Jira'], summary: 'List Jira projects',
        responses: {
          200: json('Projects', {
            type: 'array',
            items: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' } } },
          }),
        },
      },
    },
    '/jira/issue/{key}': {
      parameters: [pathParam('key', 'Issue key, e.g. KAN-6')],
      get: {
        tags: ['Jira'], summary: 'Get an issue',
        responses: { 200: json('Issue', ref('JiraIssue')), 404: err('Issue does not exist or is not visible') },
      },
    },
    '/jira/issue': {
      post: {
        tags: ['Jira'], summary: 'Create an issue, or comment on the linked one',
        description: [
          'If the test case or run item is already linked to an issue, `user_notes` is',
          'posted there as a comment and no new issue is created. With no notes,',
          'nothing is sent and the reply carries `skipped: true`.',
        ].join(' '),
        requestBody: body({
          type: 'object', required: ['summary'],
          properties: {
            summary: { type: 'string' },
            description: { type: 'string' },
            user_notes: { type: 'string', description: 'Becomes the comment body when updating an existing issue' },
            project_key: { type: 'string', description: 'Defaults to the configured project' },
            issue_type: { type: 'string', default: 'Bug' },
            priority: { type: 'string', default: 'Medium' },
            test_case_id: { type: 'string', format: 'uuid' },
            test_run_item_id: { type: 'string', format: 'uuid' },
          },
        }),
        responses: {
          200: json('Created or updated', {
            type: 'object',
            properties: {
              key: { type: 'string' },
              url: { type: 'string', format: 'uri' },
              updated: { type: 'boolean', description: 'true when an existing issue was commented on' },
              skipped: { type: 'boolean', description: 'true when there were no notes to send' },
            },
          }),
          400: err('No project key, or Jira is not configured'),
        },
      },
    },
    '/jira/link/test-case': {
      post: {
        tags: ['Jira'], summary: 'Link a test case to an issue',
        requestBody: body({
          type: 'object', required: ['test_case_id', 'issue_key'],
          properties: { test_case_id: { type: 'string', format: 'uuid' }, issue_key: { type: 'string', example: 'KAN-6' } },
        }),
        responses: { 200: json('Linked', ref('Success')) },
      },
    },
    '/jira/link/test-case/{testCaseId}': {
      parameters: [pathParam('testCaseId', 'Test case id')],
      get: {
        tags: ['Jira'], summary: 'Get the linked issue key',
        responses: { 200: json('Link', { type: 'object', properties: { issue_key: { type: 'string', nullable: true } } }) },
      },
      delete: { tags: ['Jira'], summary: 'Unlink', responses: { 200: json('Unlinked', ref('Success')) } },
    },
    '/jira/test-case/{testCaseId}/comment': {
      parameters: [pathParam('testCaseId', 'Test case id')],
      post: {
        tags: ['Jira'], summary: 'Comment on the issue linked to a test case',
        description: [
          'Posts only to Jira; it does not create an in-app comment. To do both, use',
          '`send_to_jira` on the test-case comment endpoint instead.',
        ].join(' '),
        requestBody: body({ type: 'object', required: ['content'], properties: { content: { type: 'string' } } }),
        responses: {
          200: json('Posted', {
            type: 'object',
            properties: { success: { type: 'boolean' }, key: { type: 'string' }, url: { type: 'string', format: 'uri' } },
          }),
          400: err('Not linked to an issue, or Jira is not configured'),
          404: err('The linked issue no longer exists'),
        },
      },
    },
    '/jira/comment/{issueKey}': {
      parameters: [pathParam('issueKey', 'Issue key')],
      post: {
        tags: ['Jira'], summary: 'Post a test run report as a comment',
        requestBody: body({
          type: 'object', required: ['run_id'],
          properties: { run_id: { type: 'string', format: 'uuid' } },
        }),
        responses: { 200: json('Posted', ref('Success')), 400: err('run_id required') },
      },
    },

    // ------------------------------------------------------------------ CI
    '/ci/projects/{projectId}/cases': {
      parameters: [projectId],
      get: {
        tags: ['CI'], summary: 'List active test cases', security: apiKey,
        responses: { 200: json('Test cases', arrayOf('TestCase')), 401: err('Missing or invalid X-API-Key') },
      },
    },
    '/ci/projects/{projectId}/runs': {
      parameters: [projectId],
      post: {
        tags: ['CI'], summary: 'Start a run from a pipeline', security: apiKey,
        description: 'With no `case_titles`, every active test case in the project is included.',
        requestBody: body({
          type: 'object', required: ['name'],
          properties: {
            name: { type: 'string', example: 'CI build 412' },
            description: { type: 'string' },
            build_version: { type: 'string' },
            environment: { type: 'string' },
            case_titles: {
              type: 'array', items: { type: 'string' },
              description: 'Restrict the run to these test case titles',
            },
          },
        }),
        responses: { 201: json('Created', ref('TestRun')), 401: err('Missing or invalid X-API-Key') },
      },
    },
    '/ci/runs/{runId}': {
      parameters: [pathParam('runId', 'Run id')],
      get: { tags: ['CI'], summary: 'Get a run', security: apiKey, responses: { 200: json('Run', ref('TestRun')) } },
      delete: { tags: ['CI'], summary: 'Delete a run', security: apiKey, responses: { 200: json('Deleted', ref('Success')) } },
    },
    '/ci/runs/{runId}/results': {
      parameters: [pathParam('runId', 'Run id')],
      post: {
        tags: ['CI'], summary: 'Submit results', security: apiKey,
        requestBody: body({
          type: 'object', required: ['results'],
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Matched against the test case title' },
                  status: { type: 'string', enum: ['passed', 'failed', 'blocked', 'skipped'] },
                  notes: { type: 'string' },
                  duration: { type: 'integer', description: 'Seconds' },
                },
              },
            },
          },
        }),
        responses: {
          200: json('Recorded', {
            type: 'object',
            properties: { success: { type: 'boolean' }, updated: { type: 'integer' } },
          }),
        },
      },
    },
    '/ci/runs/{runId}/complete': {
      parameters: [pathParam('runId', 'Run id')],
      post: { tags: ['CI'], summary: 'Mark the run complete', security: apiKey, responses: { 200: json('Completed', ref('TestRun')) } },
    },

    // ------------------------------------------------------------- Crawler
    '/projects/{projectId}/crawl/start': {
      parameters: [projectId],
      post: {
        tags: ['Crawler'], summary: 'Start a crawl',
        requestBody: body({
          type: 'object', required: ['url'],
          properties: {
            url: { type: 'string', format: 'uri' },
            login: { type: 'string', description: 'Override the stored credential to use' },
            max_pages: { type: 'integer', default: 15 },
            max_depth: { type: 'integer', default: 2 },
          },
        }),
        responses: { 200: json('Started', { type: 'object', properties: { jobId: { type: 'string' } } }) },
      },
    },
    '/projects/{projectId}/crawl/status/{jobId}': {
      parameters: [projectId, pathParam('jobId', 'Crawl job id')],
      get: { tags: ['Crawler'], summary: 'Crawl progress', responses: { 200: json('Status', { type: 'object' }) } },
    },
    '/projects/{projectId}/crawl/stop/{jobId}': {
      parameters: [projectId, pathParam('jobId', 'Crawl job id')],
      post: { tags: ['Crawler'], summary: 'Stop a crawl', responses: { 200: json('Stopped', ref('Success')) } },
    },
    '/projects/{projectId}/crawl/credentials': {
      parameters: [projectId],
      get: { tags: ['Crawler'], summary: 'List saved credentials', responses: { 200: json('Credentials', { type: 'array', items: { type: 'object' } }) } },
      post: {
        tags: ['Crawler'], summary: 'Save a credential',
        requestBody: body({
          type: 'object', required: ['label', 'url_pattern', 'username', 'password'],
          properties: {
            label: { type: 'string' },
            url_pattern: { type: 'string', description: 'Which URLs this credential applies to' },
            login_url: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string', format: 'password' },
            username_field: { type: 'string', description: 'CSS selector' },
            password_field: { type: 'string', description: 'CSS selector' },
          },
        }),
        responses: { 201: json('Saved', ref('Success')) },
      },
    },
    '/projects/{projectId}/crawl/credentials/{credId}': {
      parameters: [projectId, pathParam('credId', 'Credential id')],
      put: { tags: ['Crawler'], summary: 'Update a credential', requestBody: body({ type: 'object' }), responses: { 200: json('Updated', ref('Success')) } },
      delete: { tags: ['Crawler'], summary: 'Delete a credential', responses: { 200: json('Deleted', ref('Success')) } },
    },
    '/projects/{projectId}/crawl/record/start': {
      parameters: [projectId],
      post: {
        tags: ['Crawler'], summary: 'Start a browser recording',
        requestBody: body({ type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } }),
        responses: { 200: json('Started', { type: 'object', properties: { sessionId: { type: 'string' } } }) },
      },
    },
    '/projects/{projectId}/crawl/record/status/{sessionId}': {
      parameters: [projectId, pathParam('sessionId', 'Recording session id')],
      get: { tags: ['Crawler'], summary: 'Recording progress', responses: { 200: json('Status', { type: 'object' }) } },
    },
    '/projects/{projectId}/crawl/record/stop/{sessionId}': {
      parameters: [projectId, pathParam('sessionId', 'Recording session id')],
      post: {
        tags: ['Crawler'], summary: 'Stop recording and keep the steps',
        responses: { 200: json('Stopped', { type: 'object' }) },
      },
    },

    // ------------------------------------------------------------- Scripts
    '/projects/{projectId}/scripts/export': {
      parameters: [projectId],
      post: {
        tags: ['Scripts'], summary: 'Export test cases as automation scripts',
        requestBody: body({
          type: 'object', required: ['test_case_ids'],
          properties: {
            test_case_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
            framework: { type: 'string', enum: ['playwright', 'cypress', 'selenium'], default: 'playwright' },
            mark_automated: {
              type: 'boolean', default: true,
              description: 'Also set the exported cases to automated',
            },
          },
        }),
        responses: { 200: { description: 'A zip archive of the generated scripts', content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } } },
      },
    },
    '/projects/{projectId}/scripts/preview/{id}': {
      parameters: [projectId, pathParam('id', 'Test case id')],
      get: {
        tags: ['Scripts'], summary: 'Preview a generated script',
        parameters: [{ name: 'framework', in: 'query', schema: { type: 'string', enum: ['playwright', 'cypress', 'selenium'], default: 'playwright' } }],
        responses: { 200: json('Script', { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' } } }) },
      },
    },

    // -------------------------------------------------------------- System
    '/health': {
      get: {
        tags: ['System'], summary: 'Health check', security: [],
        responses: { 200: json('Healthy', { type: 'object', properties: { status: { type: 'string', example: 'ok' } } }) },
      },
    },
  },
};
