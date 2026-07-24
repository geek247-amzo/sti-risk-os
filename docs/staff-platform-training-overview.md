# STI Risk Staff Platform Training Overview

Last verified against the deployed code and production database: 14 July 2026.

Live staff portal: `https://stirisk.cloudmonkey.co.za/staff/`

## 1. What the platform is

The STI Risk platform combines a public company website with an authenticated staff operating system. The staff system connects the operational chain:

`Client -> Site -> Asset -> Work Type -> Quote -> Client PO -> Sales Order -> Subcontractor PO -> Field Work -> Report -> Invoice -> Evidence`

It is designed to keep client, sales, delivery, contractor, sign-off, and finance context in one PostgreSQL-backed system. Steve AI sits across these records as a search, drafting, recommendation, and task assistant. External messages and financial or destructive actions remain approval-controlled.

The platform is not Sage or an ERP. Sales orders are drafted internally and marked ready for Sage, but this training guide does not describe an STI Electrical or Sage integration.

## 2. Access and login

1. Open the staff URL.
2. Select **Continue with Microsoft** and use an approved `stirisk.co.za` Microsoft account.
3. Password login is intended only for configured break-glass administration.
4. A signed-in session lasts up to seven days and is invalidated when the user logs out.

The database supports `admin`, `staff`, `agent`, and `viewer` roles. Most day-to-day screens are shared staff workspaces rather than individually customized role dashboards. Steve has a separate `agent` identity so his actions can be audited separately from human actions.

## 3. Portal layout and common controls

The left navigation is grouped into **Operate**, **System**, and **Legacy** areas. On mobile, open it with the menu icon.

- **Global search:** searches indexed operational content and opens supported contacts, deals, tasks, invoices, and quotes.
- **Help:** starts guided tours for the portal overview, quote-to-report workflow, and Steve AI. The first-time overview can be skipped and replayed later.
- **Ask Steve:** opens the AI workspace or chat.
- **Refresh buttons:** reload a screen from the live database; useful after an automation or another staff member changes a record.
- **Status labels:** describe the current workflow state. A status does not change until the relevant action is completed successfully.

## 4. Main staff screens

### Command Centre (`/staff`)

Use this as the daily starting point. It summarizes pipeline value, open quotes and value, urgent work, and outstanding finance. It also shows the operating chain and short queues for quotes, active work, and finance attention.

This screen is an overview, not a full work queue. Open the relevant module to edit records.

### Vusi Workspace (`/staff/vusi`)

This is an operations-focused summary for technical and delivery work. It highlights quotes needing drafting or review, quotes sent or accepted, active site work, new risks or extra work, and outstanding invoices. Use the queues to decide what requires attention next.

### Clients (`/staff/clients`)

The client folder is the central account view.

- Search by organization or contact.
- Select a client to view contacts, projects/work, quotes, reports, evidence, and related Steve history.
- Select **New customer** to create an organization and, optionally, its first contact.
- Set the relationship type:
  - **End user:** a direct client relationship and the default.
  - **Strategic:** STI complements the partner's offer and may act as main contractor.
  - **Collaborative:** a peer or partner that performs similar work.
- Relationship type is classification only. It does not change reports, approvals, or routing.
- For a completed report, **Send sign-off link** creates or rotates a secure client link and queues the outbound notification for staff approval.

### Work (`/staff/work`)

The Work Board is the staff task-management area.

- View work as a Kanban board or calendar.
- Filter by owner and search by task content.
- Select **New Task**, or use the plus icon on a specific stage.
- Move tasks between Backlog, Scheduled, In Progress, Review / QA, and Completed.
- Open a task to edit title, description, owner, priority, status, dates, and linked context.
- Add comments and review stage history.
- Tasks can be linked to a client, deal, project, contact, or other operational context.

Steve-created tasks should appear here, normally in **Backlog**, with Steve recorded as their source.

### Quotes (`/staff/quotes`)

The quote register supports search, status filtering, totals, margins, technical-validation state, and attention indicators.

Available entry points:

- **New Quote:** the full desktop quote builder.
- **On-site Quote:** a lighter, mobile-friendly entry screen.
- Quote detail: editing, technical checks, workflow actions, printing/PDF, and client acceptance.

Every quote must contain:

1. One or more **Technology** lines, normally selected from the parts bank.
2. Exactly one combined **Labour / travel / accommodation** line.
3. Exactly one **SLA** line containing the service-level terms.

The workflow is:

`Draft -> Pending technical review -> Approved internal -> Sent to client -> Accepted or Rejected`

Important controls:

- Run **Steve Technical Check** before internal approval. Internal approval requires a green result.
- Sending to the client is blocked until all lines are classified and the three-part structure is complete.
- **Print / Save PDF** uses the browser print dialog.
- Once the quote is `sent_to_client`, **Generate sign-off link** creates a secure URL, displays a QR code, and queues a remote notification for approval.
- For in-person signing, the client can scan the QR code or staff can open the displayed URL immediately. The outbound email/WhatsApp approval does not need to complete first.
- A valid client signature changes the quote to `accepted` and stores the signer and signature artifact.

The on-site screen creates the same standard draft as the desktop screen. It does not bypass technical review, internal approval, or quote-structure validation. After creation, continue the workflow on the quote detail page.

### POs & Orders (`/staff/po-orders`)

Use this screen to capture a client purchase order and match it to an accepted quote.

1. Select **Capture PO**.
2. Choose the matched quote when known.
3. Enter the PO number, amount, received date, and optional file.
4. Save the record.

If the PO is matched to a quote with sufficient context, the system automatically creates a sales-order draft in the same transaction. If it is unmatched, it remains in the PO inbox and no invalid sales order is created.

Current boundary: uploading a file does not parse or extract PO details. “Ask Steve to extract” wording is aspirational; staff must capture and match the structured details manually today. The manual sales-order draft endpoint remains available as a technical fallback, but there is no separate staff button exposed for every edge case.

### Field Work (`/staff/field-work`)

Use Field Work to create site work, issue subcontractor POs, and create secure job links.

- **New work item:** enter title, work type, priority, due date, and scope.
- Work types include service, audit, technical survey, site visit, and extra live work.
- **Issue subcontractor PO:** choose a work item and subcontractor, then enter PO number, amount, and due date.
- Issuing the PO automatically creates and links one secure job link.
- It also creates one pending notification draft using the subcontractor's preferred channel. Staff must approve the message in Steve AI before it sends.
- Reissuing replaces or supersedes the pending notification instead of stacking duplicates.
- **Generate job link** can be used manually for an active job when needed.

The external token path accepts a submitted checklist, fault notes, recommendations, and quote-line suggestions. Current field reporting is a final submission, not a progressively autosaved report assembled over multiple visits.

### Reports (`/staff/reports`)

Despite its name, this page currently shows CRM and sales reporting: pipeline by stage, deal status, source, owner, monthly deal creation, open value, and CSV export.

Completed service reports are currently surfaced mainly in the relevant **Client** folder. There is no complete progressive report-authoring screen yet, and `service_reports` are not yet included in Steve's RAG index. Do not train users to expect this page to write or finalize field service reports.

### Assets & Risk (`/staff/assets-risk`)

Use this area to build operational site context.

- Add a site linked to a client.
- Add an asset linked to a site, including manufacturer and model.
- Add a risk with client/site, severity, and recommended action.
- Review site asset counts and the risk register.

The database supports a deeper site/building/floor/area/asset hierarchy, but the current user interface directly creates sites, assets, and risks only. Compatibility, compliance, and evidence panels are placeholders for future expansion.

### Finance (`/staff/billing`)

Finance lists draft, sent, paid, overdue, and void invoices and summarizes outstanding, overdue, and paid totals.

- **New Invoice** currently captures invoice number, total, status, and due date.
- The backend blocks creation of an invoice linked to a project that lacks client sign-off.
- The backend also blocks changing a subcontractor PO to `paid` without a valid sign-off for its project/work item.

Current UI limitation: the basic New Invoice form does not expose project, deal, or client linkage. Therefore, users should not assume an unlinked invoice created from this form has exercised the project sign-off gate. Until the finance UI is expanded, linked operational invoicing should be verified carefully.

### Subcontractors (`/staff/subcontractors`)

Use this directory to add and maintain subcontractors.

- Capture name, primary contact, email, phone, region, work types, operational status, compliance status, notes, and preferred channel.
- Preferred channel is either email or WhatsApp and controls which draft is created when a subcontractor PO is issued.
- Configure a default rate and optional ZAR rate per work type.
- Review active PO count and pending amount.

Region is currently free text. Use consistent spelling because there is no controlled territory list or automatic territory routing yet. The **Recommend contractor** button opens Steve; it does not currently run a dedicated rate/territory ranking tool.

### Steve AI (`/staff/steve`) and Chat (`/staff/chat`)

The Steve AI page explains capability boundaries and lists pending approvals. Use **Open chat** for natural-language work.

In chat:

- Start, archive, or delete personal chat sessions.
- Type `/` to link an exact customer, project, site, invoice, or quote to the prompt.
- Attach up to five files per upload, maximum 20 MB each.
- PDF, text, CSV, JSON, Markdown, and log content can be extracted for prompt context. Other files are attached as references.
- OneDrive documents can be linked through the Docs screen.
- Steve can search/summarize records, create internal tasks and comments, log internal notes, and prepare Outlook drafts.
- Proposed deal, contact, project, growth, outbound, financial, terminal-stage, or destructive changes require approval or are disallowed.

Use exact instructions. For example: “Create a high-priority task for Mellissa due Friday to call GeekBox, linked to /customer GeekBox.” After a successful action, verify the task in **Work**. Treat a conversational suggestion such as “Would you like me to proceed?” as a proposal, not proof that a record was created.

The Steve AI approvals list is the common review point for subcontractor notifications and client sign-off notifications. **Approve** executes the registered outbound handler; **Reject** prevents execution.

### Automations (`/staff/automations`)

This is a capability map, not a workflow editor. It lists intended WhatsApp, email, PO, report, follow-up, Sage, Microsoft Graph, and Steve/n8n automations. Use **Integration status** to inspect live health. Do not assume every card represents an enabled workflow.

### Settings (`/staff/settings`)

Settings is an operational health dashboard. It shows staff users, pipeline/task stages, import history, Microsoft SSO status, Lemlist status, and WhatsApp connection/delivery/outbox health. Authorized staff can retry eligible failed WhatsApp outbox items.

### Legacy modules

- **Legacy CRM:** sales pipeline and imported Pipedrive deals.
- **Contacts:** contact management, image-based lead intake, consent/suppression, campaign enrollment, and follow-up task creation.
- **Growth:** Lemlist campaign performance, recommendations, quote follow-ups, dormant clients, and partner prospects.
- **Email:** Microsoft inbox and Steve-generated email drafts. Approval creates an Outlook draft; staff sends it from Microsoft 365.
- **Docs:** recent OneDrive documents and the ability to link a document to a Steve chat.
- **Projects:** project register and manual project creation linked to a deal/client where available.
- **Schedule:** due work and calendar-oriented task visibility.

These modules remain useful, but the main STI Risk operating workflow should start from the non-legacy Client, Quote, PO, Field Work, and Work screens.

## 5. Recommended end-to-end operating procedure

1. Create or locate the client in **Clients** and confirm relationship type and primary contact.
2. Add the site and known assets in **Assets & Risk**, or create the site during quote entry.
3. Create the quote with technology, combined labour/travel/accommodation, and SLA lines.
4. Run the technical check, move to technical review, obtain internal approval, and mark it sent.
5. Generate the sign-off link for in-person QR signing or approve the queued remote notification.
6. When accepted, capture the client PO and match it to the quote. Confirm the sales-order draft was created.
7. Create the work item in **Field Work** and issue the subcontractor PO.
8. Review and approve the automatically queued subcontractor notification in **Steve AI**.
9. Review the field submission and service-report/sign-off state in the client folder.
10. Obtain client sign-off before linked invoicing or subcontractor payment.
11. Track internal follow-ups in **Work** and use Steve for summaries or audited task creation.

## 6. External user experiences

Clients and subcontractors do not need a staff account for secure token links.

- A client sign-off page shows the relevant completed work or quote, signer name, signer role, and a touch/mouse signature pad.
- Sign-off links expire or become unusable after submission, revocation, or token rotation.
- A subcontractor job link is tied to its work item and PO and is intended as the field submission channel.
- Sending either link externally remains approval-controlled; displaying a quote QR code in person is independent of outbound sending.

## 7. Data, AI, and integrations

- **PostgreSQL + pgvector:** system of record, sessions, audit events, CRM, operations, finance, chat, and semantic-search documents.
- **Steve / Gemini through n8n:** chat reasoning and RAG-assisted context.
- **RAG index:** includes operating doctrine, quote content/lines, field submissions, projects, tasks/history, and other indexed CRM records. Reindexing is scheduled daily in the exported n8n workflow.
- **Microsoft Entra and Graph:** SSO, inbox/doc access, OneDrive linking, and Outlook draft creation.
- **WhatsApp messenger:** approved inbound staff access and queued outbound delivery.
- **Lemlist:** legacy/outbound growth campaign execution and webhooks.
- **Local uploads:** Steve chat files are stored in the application upload volume; supported document text is extracted. OneDrive linking/upload is available where Microsoft is connected.

All material actions generate audit events or tool-call records. The code-level action gate, not Steve's doctrine text, is the enforced source of truth for approval requirements.

## 8. Current production usage snapshot

At verification time, production contained approximately:

- 399 organizations and 410 contacts.
- 475 legacy CRM deals.
- 112 tasks.
- 4 quotes.
- 4 subcontractors.
- 1 work item.
- No production projects, client POs, sales orders, subcontractor POs, field submissions, service reports, or invoices yet.
- 499 indexed embedding documents.

This means several workflows are implemented but have little or no production history. Training should include controlled test records before expecting meaningful dashboards or Steve similarity suggestions.

## 9. Important current limitations

1. Progressive field report assembly is not built; field submission is effectively one final submission.
2. Service reports are not yet embedded for Steve search/summarization.
3. The parts bank is seed-based; there is no parts/pricing administration screen or annual refresh workflow.
4. Photo-to-technology matching is not built. Image intake stores lead context; it does not perform vision-based part identification.
5. Raw PO extraction and automatic matching are not built; staff capture the structured PO fields.
6. The Finance form does not yet expose operational linkage, even though the backend has a linked-record sign-off gate.
7. Subcontractor territory is free text and is not used for automatic routing.
8. Several Automations cards describe planned capability rather than enabled workflows.
9. The Reports screen is CRM analytics, not the progressive service-report workspace.
10. A newly generated quote sign-off URL should be copied or opened while displayed; the plaintext token cannot be reconstructed from its stored hash after a refresh, and reissue rotates the link.

## 10. Suggested training curriculum

### Session 1: Orientation and records

Login, navigation, Help tours, global search, Clients, relationship type, sites, and assets.

### Session 2: Commercial workflow

Quote creation, three-part structure, technical validation, approval statuses, PDF output, client acceptance, PO capture, and sales-order draft confirmation.

### Session 3: Delivery workflow

Work items, subcontractor setup, rate cards, PO issuance, approval-gated notifications, job links, field submissions, and client sign-off.

### Session 4: Work management and finance

Task board, owners, priorities, comments, calendar, linked context, invoice tracking, and the limits of the current payment gate UI.

### Session 5: Steve and integrations

Chat sessions, `/` record linking, file/PDF attachment, useful prompting, verifying action receipts, approvals, Outlook drafts, OneDrive, WhatsApp health, and escalation boundaries.

### Training exercise rule

Use clearly named training records and delete/archive only through approved administrative procedures. Do not demonstrate outbound messaging with a real client or subcontractor unless the approval and recipient details have been checked.
