--
-- PostgreSQL database dump
--

\restrict Hoa4F3Nzx77fbdfk7I1Z7C6w1gCbPejXfTz0hkovJKOoMXBj8RZ4fI5f0qh2981

-- Dumped from database version 15.16 (Debian 15.16-0+deb12u1)
-- Dumped by pg_dump version 15.16 (Debian 15.16-0+deb12u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artifacts (
    id text NOT NULL,
    execution_id text NOT NULL,
    attempt_id text,
    node_id text,
    kind text NOT NULL,
    filename text NOT NULL,
    relative_path text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id text NOT NULL,
    user_id text,
    action text NOT NULL,
    target text,
    ip text,
    outcome text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credentials (
    id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    field_names jsonb DEFAULT '[]'::jsonb NOT NULL,
    ciphertext text NOT NULL,
    key_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: execution_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_attempts (
    id text NOT NULL,
    execution_id text NOT NULL,
    attempt_number integer NOT NULL,
    worker_id text,
    lease_token text,
    status text NOT NULL,
    error_code text,
    error_message text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: execution_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_events (
    id text NOT NULL,
    execution_id text NOT NULL,
    attempt_id text,
    sequence integer NOT NULL,
    type text NOT NULL,
    payload jsonb NOT NULL,
    trace_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: execution_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.execution_leases (
    execution_id text NOT NULL,
    attempt_id text NOT NULL,
    worker_id text NOT NULL,
    lease_token text NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.executions (
    id text NOT NULL,
    flow_id text NOT NULL,
    flow_version_id text NOT NULL,
    flow_checksum text NOT NULL,
    compiled_plan_checksum text NOT NULL,
    node_registry_version text NOT NULL,
    status text NOT NULL,
    trigger_type text NOT NULL,
    schedule_id text,
    identity_id text,
    current_attempt_id text,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 1 NOT NULL,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    output jsonb,
    current_node_id text,
    error_code text,
    error_message text,
    config_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    browser_version text,
    playwright_version text,
    timeout_ms integer NOT NULL,
    live_preview_until timestamp with time zone,
    cancel_requested_at timestamp with time zone,
    queued_at timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    event_sequence integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: flow_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flow_versions (
    id text NOT NULL,
    flow_id text NOT NULL,
    version_number integer NOT NULL,
    definition jsonb NOT NULL,
    compiled_plan jsonb NOT NULL,
    flow_checksum text NOT NULL,
    compiled_plan_checksum text NOT NULL,
    node_registry_version text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flows (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    draft_definition jsonb NOT NULL,
    draft_checksum text NOT NULL,
    draft_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_version_id text,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identities (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    locked_by_execution_id text,
    lock_token text,
    lock_expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: node_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_executions (
    id text NOT NULL,
    execution_id text NOT NULL,
    attempt_id text NOT NULL,
    node_id text NOT NULL,
    node_type text NOT NULL,
    scope_path text DEFAULT ''::text NOT NULL,
    ordinal integer NOT NULL,
    status text NOT NULL,
    input jsonb,
    output jsonb,
    error_code text,
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id text NOT NULL,
    event_id text NOT NULL,
    execution_id text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schedule_fires; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_fires (
    id text NOT NULL,
    schedule_id text NOT NULL,
    planned_fire_time timestamp with time zone NOT NULL,
    execution_id text,
    outcome text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id text NOT NULL,
    flow_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    cron_expression text,
    run_at timestamp with time zone,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    misfire_policy text DEFAULT 'RUN_ONCE'::text NOT NULL,
    overlap_policy text DEFAULT 'SKIP'::text NOT NULL,
    identity_id text,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_fire_at timestamp with time zone,
    next_fire_at timestamp with time zone,
    last_execution_id text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    csrf_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: workers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workers (
    id text NOT NULL,
    hostname text NOT NULL,
    pid integer NOT NULL,
    status text NOT NULL,
    capacity integer DEFAULT 1 NOT NULL,
    capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    playwright_version text,
    browser_version text,
    browser_healthy boolean DEFAULT false NOT NULL,
    last_heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    stopped_at timestamp with time zone
);


--
-- Data for Name: app_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_settings (key, value, updated_at) FROM stdin;
\.


--
-- Data for Name: artifacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.artifacts (id, execution_id, attempt_id, node_id, kind, filename, relative_path, content_type, size_bytes, sha256, created_at) FROM stdin;
46b8eb41-770c-4ed6-a2a7-bf1899bdbd9e	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	goto	screenshot	after-navigation.jpg	5abfee16-d26b-42c4-9295-6d8c81fffa8a/screenshot/46b8eb41-after-navigation.jpg	image/jpeg	9486	4dc094caecd8acd90f272c2ca86b070f1e16e2713211866723fe08ae797ef83e	2026-09-04 21:51:31.812623+00
29c7756e-702e-4221-967e-feffceb9c0bf	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	\N	screenshot	final.jpg	5abfee16-d26b-42c4-9295-6d8c81fffa8a/screenshot/29c7756e-final.jpg	image/jpeg	11286	2bcd81807863ea474b9ae9c481e037143c9d77bb6053e016219bf592a62c76ed	2026-09-04 21:51:32.065334+00
\.


--
-- Data for Name: audit_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_events (id, user_id, action, target, ip, outcome, metadata, created_at) FROM stdin;
d5747888-1b41-419f-9eff-5fc5d8c5809f	3d29cb79-c3af-4971-8087-441099e3fdd4	admin.create	\N	\N	success	{}	2026-09-04 21:51:30.607129+00
4dbc698d-abf4-464d-92b0-5a96a265bd10	3d29cb79-c3af-4971-8087-441099e3fdd4	auth.login	\N	127.0.0.1	success	{}	2026-09-04 21:51:30.804736+00
c9064b7e-ed71-48a1-bf1f-5071298410b5	3d29cb79-c3af-4971-8087-441099e3fdd4	credential.create	736bfa5b-906e-49f9-9188-0490656041ba	\N	success	{}	2026-09-04 21:51:30.873808+00
2e643798-1c8b-4acd-8f27-f7838f50ac83	3d29cb79-c3af-4971-8087-441099e3fdd4	flow.create	bf266b1b-ae90-4003-92e8-9a1cced18dd4	\N	success	{}	2026-09-04 21:51:30.893464+00
357b8e28-ad46-489b-b950-4cdd2b9ad8af	3d29cb79-c3af-4971-8087-441099e3fdd4	flow.publish	bf266b1b-ae90-4003-92e8-9a1cced18dd4	\N	success	{"versionNumber": 1}	2026-09-04 21:51:30.949799+00
\.


--
-- Data for Name: credentials; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.credentials (id, name, kind, field_names, ciphertext, key_version, created_at, updated_at, version) FROM stdin;
736bfa5b-906e-49f9-9188-0490656041ba	site-login	password	["username", "password"]	{"v":1,"iv":"kPiT+Su15eV024Dj","tag":"UzN8Cub+gLPHKUAQEW2iXA==","data":"JjO43KWaU3juiCAcd1pl2aLNWLDboTC+2cZUGuFR2lJm8+eEUw9bjt+u0x8A"}	1	2026-09-04 21:51:30.872432+00	2026-09-04 21:51:30.872432+00	1
\.


--
-- Data for Name: execution_attempts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.execution_attempts (id, execution_id, attempt_number, worker_id, lease_token, status, error_code, error_message, started_at, finished_at, created_at) FROM stdin;
8103333f-ac80-44f9-98cf-5017e9423408	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	e2b.local-6614-8a357e4d	R8a3L4dXmEL56NJS0m9teQx9kArjyKIG	SUCCEEDED	\N	\N	2026-09-04 21:51:31.59+00	2026-09-04 21:51:32.104+00	2026-09-04 21:51:31.584895+00
\.


--
-- Data for Name: execution_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.execution_events (id, execution_id, attempt_id, sequence, type, payload, trace_id, created_at) FROM stdin;
02a57522-f035-4193-a3b8-30988fda1e9a	5abfee16-d26b-42c4-9295-6d8c81fffa8a	\N	1	execution.created	{"actor": {"id": "3d29cb79-c3af-4971-8087-441099e3fdd4", "kind": "user"}, "flowVersion": 1, "triggerType": "manual"}	\N	2026-09-04 21:51:30.97+00
a8489ca2-670c-4dc3-bc59-5f930dd3184d	5abfee16-d26b-42c4-9295-6d8c81fffa8a	\N	2	execution.status	{"at": "2026-09-04T21:51:30.972Z", "actor": {"id": "3d29cb79-c3af-4971-8087-441099e3fdd4", "kind": "user"}, "reason": null, "status": "QUEUED"}	\N	2026-09-04 21:51:30.974+00
748dbbf5-a19b-418f-ac4b-7ad059237d60	5abfee16-d26b-42c4-9295-6d8c81fffa8a	\N	3	execution.status	{"at": "2026-09-04T21:51:31.593Z", "actor": {"id": "e2b.local-6614-8a357e4d", "kind": "worker"}, "reason": null, "status": "LEASED", "workerId": "e2b.local-6614-8a357e4d", "attemptNumber": 1}	\N	2026-09-04 21:51:31.596+00
a3a548a4-3495-4cc5-9322-6c660db38f96	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	4	execution.status	{"at": "2026-09-04T21:51:31.603Z", "actor": {"id": "e2b.local-6614-8a357e4d", "kind": "worker"}, "reason": null, "status": "STARTING"}	\N	2026-09-04 21:51:31.605+00
9b3c5b37-e3f5-44b1-ae70-40ffef91a69d	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	5	browser.started	{"persistent": false, "browserVersion": "136.0.7103.25", "playwrightVersion": "1.52.0"}	\N	2026-09-04 21:51:31.711+00
dffe281f-9b73-4726-9f50-499433d2edc6	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	6	execution.status	{"at": "2026-09-04T21:51:31.715Z", "actor": {"id": "e2b.local-6614-8a357e4d", "kind": "worker"}, "reason": null, "status": "RUNNING"}	\N	2026-09-04 21:51:31.716+00
06e83976-ab09-4644-b07e-289156103616	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	7	node.started	{"input": {"config": {}, "inputs": {}}, "nodeId": "start", "ordinal": 0, "nodeType": "control.start", "scopePath": "", "retryCount": 0}	\N	2026-09-04 21:51:31.723+00
7227b637-153f-402e-bea3-015d61f17383	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	8	node.finished	{"nodeId": "start", "output": {"inputs": {}}, "status": "SUCCEEDED", "ordinal": 0, "nodeType": "control.start", "errorCode": null, "scopePath": "", "durationMs": 6, "errorMessage": null}	\N	2026-09-04 21:51:31.728+00
2bdeeef3-c704-4436-b66e-8523ced32469	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	9	node.started	{"input": {"config": {"url": "http://127.0.0.1:3000/e2e-site/login.html"}, "inputs": {}}, "nodeId": "goto", "ordinal": 1, "nodeType": "page.goto", "scopePath": "", "retryCount": 0}	\N	2026-09-04 21:51:31.734+00
bfe79814-a235-494d-93c9-9e5eb445a4fe	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	10	artifact.created	{"kind": "screenshot", "nodeId": "goto", "filename": "after-navigation.jpg", "sizeBytes": 9486, "artifactId": "46b8eb41-770c-4ed6-a2a7-bf1899bdbd9e", "contentType": "image/jpeg"}	\N	2026-09-04 21:51:31.815+00
9df0457d-6900-46bf-a849-91222bd4af4a	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	11	node.finished	{"nodeId": "goto", "output": {"url": "http://127.0.0.1:3000/e2e-site/login.html", "status": 200}, "status": "SUCCEEDED", "ordinal": 1, "nodeType": "page.goto", "errorCode": null, "scopePath": "", "durationMs": 87, "errorMessage": null}	\N	2026-09-04 21:51:31.82+00
45cc0335-828d-4075-9a0f-cc0c6fffc754	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	12	node.started	{"input": {"config": {"value": "[SECRET]", "selector": "#username"}, "inputs": {}}, "nodeId": "user", "ordinal": 2, "nodeType": "element.fill", "scopePath": "", "retryCount": 0}	\N	2026-09-04 21:51:31.827+00
96107810-5438-4c4a-bfbc-075d510fe6ef	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	13	node.finished	{"nodeId": "user", "output": {"filled": true}, "status": "SUCCEEDED", "ordinal": 2, "nodeType": "element.fill", "errorCode": null, "scopePath": "", "durationMs": 34, "errorMessage": null}	\N	2026-09-04 21:51:31.861+00
73a28d90-46df-4ce0-b06d-237f0812caf4	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	14	node.started	{"input": {"config": {"value": "[SECRET]", "selector": "#password"}, "inputs": {}}, "nodeId": "pass", "ordinal": 3, "nodeType": "element.fill", "scopePath": "", "retryCount": 0}	\N	2026-09-04 21:51:31.868+00
3f4cdc8c-20b2-4e41-b122-d9c1555aca88	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	15	node.finished	{"nodeId": "pass", "output": {"filled": true}, "status": "SUCCEEDED", "ordinal": 3, "nodeType": "element.fill", "errorCode": null, "scopePath": "", "durationMs": 25, "errorMessage": null}	\N	2026-09-04 21:51:31.894+00
052e71dd-4f44-4051-bc8d-8e3c63d86c59	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	16	node.started	{"input": {"config": {"selector": "#login"}, "inputs": {}}, "nodeId": "submit", "ordinal": 4, "nodeType": "element.click", "scopePath": "", "retryCount": 0}	\N	2026-09-04 21:51:31.901+00
908190ff-b45e-4df6-95b6-14e20de02bd7	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	17	node.finished	{"nodeId": "submit", "output": {"clicked": true}, "status": "SUCCEEDED", "ordinal": 4, "nodeType": "element.click", "errorCode": null, "scopePath": "", "durationMs": 50, "errorMessage": null}	\N	2026-09-04 21:51:31.951+00
1f343653-1cb9-47c6-a132-8151405c2adc	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	18	node.started	{"input": {"config": {"pattern": "**/dashboard.html"}, "inputs": {}}, "nodeId": "waitUrl", "ordinal": 5, "nodeType": "page.waitForURL", "scopePath": "", "retryCount": 0}	\N	2026-09-04 21:51:31.955+00
a56860e8-eda4-4bf4-98e8-f5208e83a6e3	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	19	node.finished	{"nodeId": "waitUrl", "output": {"url": "http://127.0.0.1:3000/e2e-site/dashboard.html"}, "status": "SUCCEEDED", "ordinal": 5, "nodeType": "page.waitForURL", "errorCode": null, "scopePath": "", "durationMs": 7, "errorMessage": null}	\N	2026-09-04 21:51:31.963+00
8209b252-ce5a-4b37-8c09-921a91381e0e	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	20	node.started	{"input": {"config": {"selector": "#welcome"}, "inputs": {}}, "nodeId": "secret", "ordinal": 6, "nodeType": "element.innerText", "scopePath": "", "retryCount": 0}	\N	2026-09-04 21:51:31.969+00
942f5445-f1b1-483d-89c4-582a58baee63	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	21	node.finished	{"nodeId": "secret", "output": {"text": "Welcome, [REDACTED]"}, "status": "SUCCEEDED", "ordinal": 6, "nodeType": "element.innerText", "errorCode": null, "scopePath": "", "durationMs": 22, "errorMessage": null}	\N	2026-09-04 21:51:31.992+00
4b00987e-2368-4096-be98-caf259bb7c38	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	22	node.started	{"input": {"config": {}, "inputs": {"value": "Welcome, [REDACTED]"}}, "nodeId": "ret", "ordinal": 7, "nodeType": "control.return", "scopePath": "", "retryCount": 0}	\N	2026-09-04 21:51:31.998+00
06de2316-99a0-46b3-99ac-d60d30c2eb29	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	23	node.finished	{"nodeId": "ret", "output": {}, "status": "SUCCEEDED", "ordinal": 7, "nodeType": "control.return", "errorCode": null, "scopePath": "", "durationMs": 6, "errorMessage": null}	\N	2026-09-04 21:51:32.004+00
f190319e-a64b-4e0e-89ec-0a9973e44584	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	24	artifact.created	{"kind": "screenshot", "nodeId": null, "filename": "final.jpg", "sizeBytes": 11286, "artifactId": "29c7756e-702e-4221-967e-feffceb9c0bf", "contentType": "image/jpeg"}	\N	2026-09-04 21:51:32.067+00
70254fd3-9c9a-4e73-85e4-e554277f9243	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	25	browser.closed	{"crashed": false, "blockedRequests": 0}	\N	2026-09-04 21:51:32.098+00
4851cb12-ff55-4a39-a539-051cf9d1c4b4	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	26	execution.status	{"at": "2026-09-04T21:51:32.104Z", "actor": {"id": "e2b.local-6614-8a357e4d", "kind": "worker"}, "reason": null, "status": "SUCCEEDED", "errorCode": null}	\N	2026-09-04 21:51:32.109+00
\.


--
-- Data for Name: execution_leases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.execution_leases (execution_id, attempt_id, worker_id, lease_token, acquired_at, heartbeat_at, expires_at) FROM stdin;
\.


--
-- Data for Name: executions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.executions (id, flow_id, flow_version_id, flow_checksum, compiled_plan_checksum, node_registry_version, status, trigger_type, schedule_id, identity_id, current_attempt_id, attempt_count, max_attempts, inputs, output, current_node_id, error_code, error_message, config_snapshot, browser_version, playwright_version, timeout_ms, live_preview_until, cancel_requested_at, queued_at, started_at, finished_at, event_sequence, version, created_at, updated_at) FROM stdin;
5abfee16-d26b-42c4-9295-6d8c81fffa8a	bf266b1b-ae90-4003-92e8-9a1cced18dd4	466ed574-d8ed-4653-b0d1-90d418a0de90	adacb000b6d44396e704b039d39333c164521f80ec0efc8d80820b94d3514c0f	7b78454d2be3e8c23d90190f1c63659d4663d56ea806cb25c064d6fd6372e930	r1.0.0	SUCCEEDED	manual	\N	\N	8103333f-ac80-44f9-98cf-5017e9423408	1	1	{}	"Welcome, demo"	\N	\N	\N	{"maxPages": 5, "nodeTimeoutMs": 30000, "maxLoopIterations": 1000, "browserConcurrency": 1, "screenshotOnNavigation": true, "privateAllowListEntries": 1}	136.0.7103.25	1.52.0	900000	\N	\N	2026-09-04 21:51:30.967+00	2026-09-04 21:51:31.593+00	2026-09-04 21:51:32.104+00	26	6	2026-09-04 21:51:30.967+00	2026-09-04 21:51:32.107+00
\.


--
-- Data for Name: flow_versions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.flow_versions (id, flow_id, version_number, definition, compiled_plan, flow_checksum, compiled_plan_checksum, node_registry_version, notes, created_at) FROM stdin;
466ed574-d8ed-4653-b0d1-90d418a0de90	bf266b1b-ae90-4003-92e8-9a1cced18dd4	1	{"name": "Login E2E", "edges": [{"id": "e1", "kind": "SUCCESS", "source": "start", "target": "goto", "priority": 100}, {"id": "e2", "kind": "SUCCESS", "source": "goto", "target": "user", "priority": 100}, {"id": "e3", "kind": "SUCCESS", "source": "user", "target": "pass", "priority": 100}, {"id": "e4", "kind": "SUCCESS", "source": "pass", "target": "submit", "priority": 100}, {"id": "e5", "kind": "SUCCESS", "source": "submit", "target": "waitUrl", "priority": 100}, {"id": "e6", "kind": "SUCCESS", "source": "waitUrl", "target": "secret", "priority": 100}, {"id": "e7", "kind": "SUCCESS", "source": "secret", "target": "ret", "priority": 100}], "nodes": [{"id": "start", "type": "control.start", "config": {}, "inputs": {}, "version": 1, "position": {"x": 80, "y": 80}}, {"id": "goto", "type": "page.goto", "config": {"url": "{{baseUrl}}/login.html"}, "inputs": {}, "version": 1, "position": {"x": 340, "y": 80}}, {"id": "user", "type": "element.fill", "config": {"value": "{{username}}", "selector": "#username"}, "inputs": {}, "version": 1, "position": {"x": 600, "y": 80}}, {"id": "pass", "type": "element.fill", "config": {"value": "credential:site-login#password", "selector": "#password"}, "inputs": {}, "version": 1, "position": {"x": 860, "y": 80}}, {"id": "submit", "type": "element.click", "config": {"selector": "#login"}, "inputs": {}, "version": 1, "position": {"x": 80, "y": 240}}, {"id": "waitUrl", "type": "page.waitForURL", "config": {"pattern": "**/dashboard.html"}, "inputs": {}, "version": 1, "position": {"x": 340, "y": 240}}, {"id": "secret", "type": "element.innerText", "config": {"selector": "#welcome"}, "inputs": {}, "version": 1, "position": {"x": 600, "y": 240}}, {"id": "ret", "type": "control.return", "config": {}, "inputs": {"value": {"kind": "node", "nodeId": "secret", "output": "text"}}, "version": 1, "position": {"x": 860, "y": 240}}], "settings": {"maxAttempts": 1, "screenshotOnNavigation": true}, "variables": {"baseUrl": "http://127.0.0.1:3000/e2e-site", "username": "demo"}, "description": "Login using a credential", "schemaVersion": 1}	{"loops": {}, "nodes": {"ret": {"id": "ret", "out": {}, "type": "control.return", "label": "Return", "retry": {"backoffMs": 0, "maxAttempts": 1}, "config": {}, "inputs": {"value": {"kind": "node", "nodeId": "secret", "output": "text"}}, "version": 1, "timeoutMs": 30000, "errorPolicy": {"mode": "FAIL_FLOW"}, "sensitiveFields": [], "requiredCapabilities": []}, "goto": {"id": "goto", "out": {"SUCCESS": [{"edgeId": "e2", "target": "user", "priority": 100}]}, "type": "page.goto", "label": "Go to URL", "retry": {"backoffMs": 1000, "maxAttempts": 2}, "config": {"url": "{{baseUrl}}/login.html"}, "inputs": {}, "version": 1, "timeoutMs": 30000, "errorPolicy": {"mode": "FAIL_FLOW"}, "sensitiveFields": [], "requiredCapabilities": ["browser", "network"]}, "pass": {"id": "pass", "out": {"SUCCESS": [{"edgeId": "e4", "target": "submit", "priority": 100}]}, "type": "element.fill", "label": "Fill", "retry": {"backoffMs": 0, "maxAttempts": 1}, "config": {"value": "credential:site-login#password", "selector": "#password"}, "inputs": {}, "version": 1, "timeoutMs": 30000, "errorPolicy": {"mode": "FAIL_FLOW"}, "sensitiveFields": ["value"], "requiredCapabilities": ["browser"]}, "user": {"id": "user", "out": {"SUCCESS": [{"edgeId": "e3", "target": "pass", "priority": 100}]}, "type": "element.fill", "label": "Fill", "retry": {"backoffMs": 0, "maxAttempts": 1}, "config": {"value": "{{username}}", "selector": "#username"}, "inputs": {}, "version": 1, "timeoutMs": 30000, "errorPolicy": {"mode": "FAIL_FLOW"}, "sensitiveFields": ["value"], "requiredCapabilities": ["browser"]}, "start": {"id": "start", "out": {"SUCCESS": [{"edgeId": "e1", "target": "goto", "priority": 100}]}, "type": "control.start", "label": "Start", "retry": {"backoffMs": 0, "maxAttempts": 1}, "config": {}, "inputs": {}, "version": 1, "timeoutMs": 30000, "errorPolicy": {"mode": "FAIL_FLOW"}, "sensitiveFields": [], "requiredCapabilities": []}, "secret": {"id": "secret", "out": {"SUCCESS": [{"edgeId": "e7", "target": "ret", "priority": 100}]}, "type": "element.innerText", "label": "Inner text", "retry": {"backoffMs": 0, "maxAttempts": 1}, "config": {"selector": "#welcome"}, "inputs": {}, "version": 1, "timeoutMs": 30000, "errorPolicy": {"mode": "FAIL_FLOW"}, "sensitiveFields": [], "requiredCapabilities": ["browser"]}, "submit": {"id": "submit", "out": {"SUCCESS": [{"edgeId": "e5", "target": "waitUrl", "priority": 100}]}, "type": "element.click", "label": "Click", "retry": {"backoffMs": 0, "maxAttempts": 1}, "config": {"selector": "#login"}, "inputs": {}, "version": 1, "timeoutMs": 30000, "errorPolicy": {"mode": "FAIL_FLOW"}, "sensitiveFields": [], "requiredCapabilities": ["browser"]}, "waitUrl": {"id": "waitUrl", "out": {"SUCCESS": [{"edgeId": "e6", "target": "secret", "priority": 100}]}, "type": "page.waitForURL", "label": "Wait for URL", "retry": {"backoffMs": 0, "maxAttempts": 1}, "config": {"pattern": "**/dashboard.html"}, "inputs": {}, "version": 1, "timeoutMs": 30000, "errorPolicy": {"mode": "FAIL_FLOW"}, "sensitiveFields": [], "requiredCapabilities": ["browser"]}}, "order": ["start", "goto", "user", "pass", "submit", "waitUrl", "secret", "ret"], "entryNodeId": "start", "maxAttempts": 1, "planVersion": 1, "flowTimeoutMs": 900000, "finallyTargets": [], "screenshotOnNavigation": true}	adacb000b6d44396e704b039d39333c164521f80ec0efc8d80820b94d3514c0f	7b78454d2be3e8c23d90190f1c63659d4663d56ea806cb25c064d6fd6372e930	r1.0.0		2026-09-04 21:51:30.943943+00
\.


--
-- Data for Name: flows; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.flows (id, name, description, draft_definition, draft_checksum, draft_updated_at, current_version_id, archived_at, created_at, updated_at, version) FROM stdin;
bf266b1b-ae90-4003-92e8-9a1cced18dd4	Login E2E	Login using a credential	{"name": "Login E2E", "edges": [{"id": "e1", "kind": "SUCCESS", "source": "start", "target": "goto", "priority": 100}, {"id": "e2", "kind": "SUCCESS", "source": "goto", "target": "user", "priority": 100}, {"id": "e3", "kind": "SUCCESS", "source": "user", "target": "pass", "priority": 100}, {"id": "e4", "kind": "SUCCESS", "source": "pass", "target": "submit", "priority": 100}, {"id": "e5", "kind": "SUCCESS", "source": "submit", "target": "waitUrl", "priority": 100}, {"id": "e6", "kind": "SUCCESS", "source": "waitUrl", "target": "secret", "priority": 100}, {"id": "e7", "kind": "SUCCESS", "source": "secret", "target": "ret", "priority": 100}], "nodes": [{"id": "start", "type": "control.start", "config": {}, "inputs": {}, "version": 1, "position": {"x": 80, "y": 80}}, {"id": "goto", "type": "page.goto", "config": {"url": "{{baseUrl}}/login.html"}, "inputs": {}, "version": 1, "position": {"x": 340, "y": 80}}, {"id": "user", "type": "element.fill", "config": {"value": "{{username}}", "selector": "#username"}, "inputs": {}, "version": 1, "position": {"x": 600, "y": 80}}, {"id": "pass", "type": "element.fill", "config": {"value": "credential:site-login#password", "selector": "#password"}, "inputs": {}, "version": 1, "position": {"x": 860, "y": 80}}, {"id": "submit", "type": "element.click", "config": {"selector": "#login"}, "inputs": {}, "version": 1, "position": {"x": 80, "y": 240}}, {"id": "waitUrl", "type": "page.waitForURL", "config": {"pattern": "**/dashboard.html"}, "inputs": {}, "version": 1, "position": {"x": 340, "y": 240}}, {"id": "secret", "type": "element.innerText", "config": {"selector": "#welcome"}, "inputs": {}, "version": 1, "position": {"x": 600, "y": 240}}, {"id": "ret", "type": "control.return", "config": {}, "inputs": {"value": {"kind": "node", "nodeId": "secret", "output": "text"}}, "version": 1, "position": {"x": 860, "y": 240}}], "settings": {"maxAttempts": 1, "screenshotOnNavigation": true}, "variables": {"baseUrl": "http://127.0.0.1:3000/e2e-site", "username": "demo"}, "description": "Login using a credential", "schemaVersion": 1}	adacb000b6d44396e704b039d39333c164521f80ec0efc8d80820b94d3514c0f	2026-09-04 21:51:30.891967+00	466ed574-d8ed-4653-b0d1-90d418a0de90	\N	2026-09-04 21:51:30.891967+00	2026-09-04 21:51:30.947+00	2
\.


--
-- Data for Name: identities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.identities (id, name, description, locked_by_execution_id, lock_token, lock_expires_at, last_used_at, created_at, updated_at, version) FROM stdin;
\.


--
-- Data for Name: node_executions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.node_executions (id, execution_id, attempt_id, node_id, node_type, scope_path, ordinal, status, input, output, error_code, error_message, retry_count, started_at, finished_at, duration_ms, created_at) FROM stdin;
6dd870e7-ce3e-45c8-929a-a7a608016e56	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	start	control.start		0	SUCCEEDED	{"config": {}, "inputs": {}}	{"inputs": {}}	\N	\N	0	2026-09-04 21:51:31.72+00	2026-09-04 21:51:31.726+00	6	2026-09-04 21:51:31.719484+00
b73ab582-0abb-4b16-8d78-653a25798eba	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	goto	page.goto		1	SUCCEEDED	{"config": {"url": "http://127.0.0.1:3000/e2e-site/login.html"}, "inputs": {}}	{"url": "http://127.0.0.1:3000/e2e-site/login.html", "status": 200}	\N	\N	0	2026-09-04 21:51:31.732+00	2026-09-04 21:51:31.818+00	87	2026-09-04 21:51:31.731048+00
91df8f75-0fac-4291-97a3-c1a1caa7dd66	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	user	element.fill		2	SUCCEEDED	{"config": {"value": "[SECRET]", "selector": "#username"}, "inputs": {}}	{"filled": true}	\N	\N	0	2026-09-04 21:51:31.824+00	2026-09-04 21:51:31.858+00	34	2026-09-04 21:51:31.823065+00
e90756cb-13f8-45a8-9cf0-22c5b898621d	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	pass	element.fill		3	SUCCEEDED	{"config": {"value": "[SECRET]", "selector": "#password"}, "inputs": {}}	{"filled": true}	\N	\N	0	2026-09-04 21:51:31.866+00	2026-09-04 21:51:31.891+00	25	2026-09-04 21:51:31.864928+00
871fe260-5bce-4a2b-bf83-eb1dfc7d19f7	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	submit	element.click		4	SUCCEEDED	{"config": {"selector": "#login"}, "inputs": {}}	{"clicked": true}	\N	\N	0	2026-09-04 21:51:31.898+00	2026-09-04 21:51:31.947+00	50	2026-09-04 21:51:31.896875+00
7bd764d6-a994-4ea3-b553-a66107ec3d22	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	waitUrl	page.waitForURL		5	SUCCEEDED	{"config": {"pattern": "**/dashboard.html"}, "inputs": {}}	{"url": "http://127.0.0.1:3000/e2e-site/dashboard.html"}	\N	\N	0	2026-09-04 21:51:31.953+00	2026-09-04 21:51:31.96+00	7	2026-09-04 21:51:31.953032+00
fdf54bf7-c469-41af-8577-172645e962b2	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	secret	element.innerText		6	SUCCEEDED	{"config": {"selector": "#welcome"}, "inputs": {}}	{"text": "Welcome, demo"}	\N	\N	0	2026-09-04 21:51:31.966+00	2026-09-04 21:51:31.989+00	22	2026-09-04 21:51:31.965647+00
c57268bc-7ca7-4652-b642-631201d80b04	5abfee16-d26b-42c4-9295-6d8c81fffa8a	8103333f-ac80-44f9-98cf-5017e9423408	ret	control.return		7	SUCCEEDED	{"config": {}, "inputs": {"value": "Welcome, demo"}}	{}	\N	\N	0	2026-09-04 21:51:31.995+00	2026-09-04 21:51:32.001+00	6	2026-09-04 21:51:31.994676+00
\.


--
-- Data for Name: outbox_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.outbox_events (id, event_id, execution_id, attempts, published_at, created_at) FROM stdin;
ed441ded-aff5-4598-bd27-56d0be316186	02a57522-f035-4193-a3b8-30988fda1e9a	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:31.578+00	2026-09-04 21:51:30.96534+00
16740599-c88b-4a49-9806-5c66eabb89c0	a8489ca2-670c-4dc3-bc59-5f930dd3184d	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:31.579+00	2026-09-04 21:51:30.96534+00
07dff4ac-e96c-42ba-8f2c-4b8e89a1c85f	748dbbf5-a19b-418f-ac4b-7ad059237d60	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.582+00	2026-09-04 21:51:31.584895+00
44315b76-9c19-4053-ba68-4b1fc7e9ff94	a3a548a4-3495-4cc5-9322-6c660db38f96	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.584+00	2026-09-04 21:51:31.601686+00
3d254f5c-50a6-4b19-942a-01d0118befdb	9b3c5b37-e3f5-44b1-ae70-40ffef91a69d	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.585+00	2026-09-04 21:51:31.70766+00
2982c6f7-916e-44d7-b208-fcc5ccaeeccb	dffe281f-9b73-4726-9f50-499433d2edc6	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.586+00	2026-09-04 21:51:31.7142+00
25ad30ca-5d78-48b6-9600-876e9f2be250	06e83976-ab09-4644-b07e-289156103616	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.587+00	2026-09-04 21:51:31.719484+00
0b0048f1-5ad7-46d9-9ef3-1f41a4a67456	7227b637-153f-402e-bea3-015d61f17383	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.588+00	2026-09-04 21:51:31.725454+00
31a46480-38ff-4ba7-97fa-60f3c823d3ad	2bdeeef3-c704-4436-b66e-8523ced32469	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.589+00	2026-09-04 21:51:31.731048+00
54b0cc89-3069-4ef0-a5b7-40182d741006	bfe79814-a235-494d-93c9-9e5eb445a4fe	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.59+00	2026-09-04 21:51:31.812623+00
969bd233-c532-4acf-a769-b4fda1a91f47	9df0457d-6900-46bf-a849-91222bd4af4a	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.591+00	2026-09-04 21:51:31.817811+00
c037f93e-87e9-46f3-9f41-7223d1c6e2b3	45cc0335-828d-4075-9a0f-cc0c6fffc754	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.592+00	2026-09-04 21:51:31.823065+00
b0a21dee-dd20-4bd1-b278-c85a780b8534	96107810-5438-4c4a-bfbc-075d510fe6ef	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.592+00	2026-09-04 21:51:31.857106+00
fbeb8ad5-fc26-46f0-98ac-60ced4b0d6d5	73a28d90-46df-4ce0-b06d-237f0812caf4	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.593+00	2026-09-04 21:51:31.864928+00
dd4a6080-2f20-4ef9-941c-f97da9f98b4c	3f4cdc8c-20b2-4e41-b122-d9c1555aca88	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.594+00	2026-09-04 21:51:31.890143+00
264a965e-b417-468d-9634-62b477684ff6	052e71dd-4f44-4051-bc8d-8e3c63d86c59	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.595+00	2026-09-04 21:51:31.896875+00
c320aa6a-44db-4a0c-a9ad-1b8855d86bc8	908190ff-b45e-4df6-95b6-14e20de02bd7	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.596+00	2026-09-04 21:51:31.946763+00
6b47fe61-ce91-425d-93e2-15f106357695	1f343653-1cb9-47c6-a132-8151405c2adc	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.597+00	2026-09-04 21:51:31.953032+00
926f3bc1-0002-4831-a556-aa9b4fb6eabb	a56860e8-eda4-4bf4-98e8-f5208e83a6e3	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.598+00	2026-09-04 21:51:31.959616+00
34c4a730-3060-463d-8f8f-e10f8796d159	8209b252-ce5a-4b37-8c09-921a91381e0e	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.599+00	2026-09-04 21:51:31.965647+00
e074126e-7e2e-44bb-b26b-28aff8e0fa3a	942f5445-f1b1-483d-89c4-582a58baee63	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.6+00	2026-09-04 21:51:31.987906+00
c9629e0b-9d4c-4743-a665-0760947fa579	4b00987e-2368-4096-be98-caf259bb7c38	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.601+00	2026-09-04 21:51:31.994676+00
bb55de79-5d33-4ef5-aa32-20808e3a0525	06de2316-99a0-46b3-99ac-d60d30c2eb29	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.602+00	2026-09-04 21:51:32.000622+00
e03e38bb-070f-4bbe-a3cb-bed88a48eb4a	f190319e-a64b-4e0e-89ec-0a9973e44584	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.602+00	2026-09-04 21:51:32.065334+00
82e05814-8f74-44d8-bc24-4db8c5a0c6f0	70254fd3-9c9a-4e73-85e4-e554277f9243	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.603+00	2026-09-04 21:51:32.096145+00
13d17309-d145-4bfc-a568-7c9b7541e769	4851cb12-ff55-4a39-a539-051cf9d1c4b4	5abfee16-d26b-42c4-9295-6d8c81fffa8a	1	2026-09-04 21:51:36.604+00	2026-09-04 21:51:32.100827+00
\.


--
-- Data for Name: schedule_fires; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schedule_fires (id, schedule_id, planned_fire_time, execution_id, outcome, created_at) FROM stdin;
\.


--
-- Data for Name: schedules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schedules (id, flow_id, name, kind, cron_expression, run_at, timezone, enabled, misfire_policy, overlap_policy, identity_id, inputs, last_fire_at, next_fire_at, last_execution_id, version, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_sessions (id, user_id, token_hash, csrf_token, expires_at, revoked_at, last_seen_at, ip, user_agent, created_at) FROM stdin;
2dc5e471-e4bd-419d-acf3-c36f5412ef41	3d29cb79-c3af-4971-8087-441099e3fdd4	4b6678119ffec72c12a5a8196ee848d3d610a00c28605631797a14c5a713d970	_zID1sKoSlsxBsWFZ9UduXylUs43-pOz	2026-09-11 21:51:30.801+00	\N	2026-09-04 21:51:30.802664+00	127.0.0.1	curl/7.88.1	2026-09-04 21:51:30.802664+00
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, password_hash, created_at, updated_at, version) FROM stdin;
3d29cb79-c3af-4971-8087-441099e3fdd4	admin@example.com	$argon2id$v=19$m=65536,p=1,t=3$cdyyedBgKGxpker4JC/Ccw$zoGKup6MGdfxbKptXp5ovCvhx+kcexzSjH0p8q8pSi4	2026-09-04 21:51:30.604693+00	2026-09-04 21:51:30.604693+00	1
\.


--
-- Data for Name: workers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.workers (id, hostname, pid, status, capacity, capabilities, playwright_version, browser_version, browser_healthy, last_heartbeat_at, started_at, stopped_at) FROM stdin;
stability-5504	stability	5504	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:47:57.505757+00	2026-09-04 21:47:57.505757+00	\N
smoke-7409	smoke	7409	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:52:07.538359+00	2026-09-04 21:52:07.538359+00	\N
smoke-7557	smoke	7557	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:52:09.263076+00	2026-09-04 21:52:09.263076+00	\N
smoke-7699	smoke	7699	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:52:10.973584+00	2026-09-04 21:52:10.973584+00	\N
smoke-7840	smoke	7840	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:52:12.51443+00	2026-09-04 21:52:12.51443+00	\N
smoke-7984	smoke	7984	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:52:14.126212+00	2026-09-04 21:52:14.126212+00	\N
smoke-8074	smoke	8074	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:52:15.563332+00	2026-09-04 21:52:15.563332+00	\N
e2b.local-6614-8a357e4d	e2b.local	6614	ONLINE	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:53:07.058+00	2026-09-04 21:51:12.039744+00	\N
smoke-6960	smoke	6960	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:52:02.014273+00	2026-09-04 21:52:02.014273+00	\N
smoke-7109	smoke	7109	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:52:03.619156+00	2026-09-04 21:52:03.619156+00	\N
smoke-7257	smoke	7257	LOST	1	["browser", "network", "filesystem"]	1.52.0	136.0.7103.25	t	2026-09-04 21:52:05.483593+00	2026-09-04 21:52:05.483593+00	\N
\.


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: artifacts artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_pkey PRIMARY KEY (id);


--
-- Name: artifacts artifacts_relative_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_relative_path_unique UNIQUE (relative_path);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: credentials credentials_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_name_unique UNIQUE (name);


--
-- Name: credentials credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credentials
    ADD CONSTRAINT credentials_pkey PRIMARY KEY (id);


--
-- Name: execution_attempts execution_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_attempts
    ADD CONSTRAINT execution_attempts_pkey PRIMARY KEY (id);


--
-- Name: execution_events execution_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_events
    ADD CONSTRAINT execution_events_pkey PRIMARY KEY (id);


--
-- Name: execution_leases execution_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_leases
    ADD CONSTRAINT execution_leases_pkey PRIMARY KEY (execution_id);


--
-- Name: executions executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executions
    ADD CONSTRAINT executions_pkey PRIMARY KEY (id);


--
-- Name: flow_versions flow_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_versions
    ADD CONSTRAINT flow_versions_pkey PRIMARY KEY (id);


--
-- Name: flows flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_pkey PRIMARY KEY (id);


--
-- Name: identities identities_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identities
    ADD CONSTRAINT identities_name_unique UNIQUE (name);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: node_executions node_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: schedule_fires schedule_fires_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_fires
    ADD CONSTRAINT schedule_fires_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_token_hash_unique UNIQUE (token_hash);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workers workers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_pkey PRIMARY KEY (id);


--
-- Name: artifacts_exec_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artifacts_exec_idx ON public.artifacts USING btree (execution_id);


--
-- Name: audit_events_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_action_idx ON public.audit_events USING btree (action, created_at);


--
-- Name: execution_attempts_exec_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX execution_attempts_exec_number_uq ON public.execution_attempts USING btree (execution_id, attempt_number);


--
-- Name: execution_events_exec_seq_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX execution_events_exec_seq_uq ON public.execution_events USING btree (execution_id, sequence);


--
-- Name: execution_leases_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX execution_leases_expires_idx ON public.execution_leases USING btree (expires_at);


--
-- Name: executions_flow_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX executions_flow_idx ON public.executions USING btree (flow_id, created_at);


--
-- Name: executions_schedule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX executions_schedule_idx ON public.executions USING btree (schedule_id);


--
-- Name: executions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX executions_status_idx ON public.executions USING btree (status, created_at);


--
-- Name: flow_versions_flow_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX flow_versions_flow_number_uq ON public.flow_versions USING btree (flow_id, version_number);


--
-- Name: flows_archived_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX flows_archived_idx ON public.flows USING btree (archived_at);


--
-- Name: flows_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX flows_name_idx ON public.flows USING btree (name);


--
-- Name: node_executions_attempt_ordinal_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX node_executions_attempt_ordinal_uq ON public.node_executions USING btree (attempt_id, ordinal);


--
-- Name: node_executions_exec_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX node_executions_exec_idx ON public.node_executions USING btree (execution_id);


--
-- Name: outbox_unpublished_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_unpublished_idx ON public.outbox_events USING btree (published_at, created_at);


--
-- Name: schedule_fires_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX schedule_fires_uq ON public.schedule_fires USING btree (schedule_id, planned_fire_time);


--
-- Name: schedules_next_fire_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedules_next_fire_idx ON public.schedules USING btree (enabled, next_fire_at);


--
-- Name: user_sessions_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sessions_expires_idx ON public.user_sessions USING btree (expires_at);


--
-- Name: user_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sessions_user_idx ON public.user_sessions USING btree (user_id);


--
-- Name: artifacts artifacts_execution_id_executions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_execution_id_executions_id_fk FOREIGN KEY (execution_id) REFERENCES public.executions(id) ON DELETE CASCADE;


--
-- Name: execution_attempts execution_attempts_execution_id_executions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_attempts
    ADD CONSTRAINT execution_attempts_execution_id_executions_id_fk FOREIGN KEY (execution_id) REFERENCES public.executions(id) ON DELETE CASCADE;


--
-- Name: execution_events execution_events_execution_id_executions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_events
    ADD CONSTRAINT execution_events_execution_id_executions_id_fk FOREIGN KEY (execution_id) REFERENCES public.executions(id) ON DELETE CASCADE;


--
-- Name: execution_leases execution_leases_execution_id_executions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.execution_leases
    ADD CONSTRAINT execution_leases_execution_id_executions_id_fk FOREIGN KEY (execution_id) REFERENCES public.executions(id) ON DELETE CASCADE;


--
-- Name: executions executions_flow_id_flows_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executions
    ADD CONSTRAINT executions_flow_id_flows_id_fk FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE;


--
-- Name: executions executions_flow_version_id_flow_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.executions
    ADD CONSTRAINT executions_flow_version_id_flow_versions_id_fk FOREIGN KEY (flow_version_id) REFERENCES public.flow_versions(id) ON DELETE CASCADE;


--
-- Name: flow_versions flow_versions_flow_id_flows_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_versions
    ADD CONSTRAINT flow_versions_flow_id_flows_id_fk FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE;


--
-- Name: node_executions node_executions_execution_id_executions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_executions
    ADD CONSTRAINT node_executions_execution_id_executions_id_fk FOREIGN KEY (execution_id) REFERENCES public.executions(id) ON DELETE CASCADE;


--
-- Name: outbox_events outbox_events_event_id_execution_events_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_event_id_execution_events_id_fk FOREIGN KEY (event_id) REFERENCES public.execution_events(id) ON DELETE CASCADE;


--
-- Name: schedule_fires schedule_fires_schedule_id_schedules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_fires
    ADD CONSTRAINT schedule_fires_schedule_id_schedules_id_fk FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;


--
-- Name: schedules schedules_flow_id_flows_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_flow_id_flows_id_fk FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict Hoa4F3Nzx77fbdfk7I1Z7C6w1gCbPejXfTz0hkovJKOoMXBj8RZ4fI5f0qh2981

