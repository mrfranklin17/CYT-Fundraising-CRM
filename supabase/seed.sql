-- Grantboard :: seed data for Christian Youth Theater - Spokane
--
-- Everything in this file is real and verified against a primary source:
-- the organization's own site, its IRS Form 990 filings (via ProPublica
-- Nonprofit Explorer), and the funders' own grant pages.
--
-- Where CYT's own numbers are not known to us -- enrollment, scholarship
-- totals, demographics, audience attendance -- the text says
-- [CONFIRM: ...] instead of a plausible-looking figure. Do not "finish"
-- those by guessing. A number invented here becomes a number in a grant
-- application, and a wrong number in a grant application is fraud.
--
-- Safe to re-run: every insert is idempotent.

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------

insert into public.orgs (
  id, slug, name, legal_name, ein, tax_exempt_status, exemption_issued_on,
  ntee_code, ntee_label, founded_year,
  address_line1, address_line2, city, state, postal_code,
  phone, website, fiscal_year_type, executive_name, executive_title,
  mission, mission_notes
) values (
  '11111111-1111-4111-8111-111111111111',
  'cyt-spokane',
  'Christian Youth Theater - Spokane',
  'Christian Youth Theater - Spokane',
  '91-1949474',
  '501(c)(3)',
  '2000-06-01',
  'A60',
  'Performing Arts',
  1998,
  '3901 E. Main Ave',
  'Suite A',
  'Spokane',
  'WA',
  '99202',
  '(509) 487-6540',
  'https://www.cytspokane.org',
  'Calendar year (January 1 - December 31)',
  'Kristine Lyons',
  'Executive Artistic Director',
  $mission$Christian Youth Theater develops character and creativity in kids of all ages through quality theater arts training that brings families and communities together while reflecting the Creator.$mission$,
  $notes$WORDING: CYT National words the final clause "while reflecting Jesus." The Spokane affiliate's wording is "while reflecting the Creator." Use the Spokane wording in Spokane applications, and be aware a funder who reads the national site will see the other phrasing. Do not silently harmonize the two.

WHAT SECULAR AND PUBLIC FUNDERS ACTUALLY TEST: not whether the mission is faith-based, but whether religious participation is a condition of receiving services. Spokane Arts, for example, excludes "Organizations that require participation in religious services and/or education as a condition of receiving services" -- an organization with a faith-rooted mission is still eligible if it does not gate services that way.

[CONFIRM with staff] before any secular or public application: does CYT Spokane require participation in religious services or religious education as a condition of enrollment, casting, or receiving any service? Get the answer in the staff's own words and record it in the answer library. Do not infer it from the mission statement in either direction.$notes$
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Form 990 financial history
-- Source: IRS Form 990 via ProPublica Nonprofit Explorer.
-- ---------------------------------------------------------------------------

insert into public.org_financials (
  org_id, fiscal_year, revenue, expenses, net,
  contributions, program_revenue, net_assets, source
) values
  ('11111111-1111-4111-8111-111111111111', 2024, 391024, 432573,  -41549,  21025, 357885, 191198, 'IRS Form 990 via ProPublica Nonprofit Explorer'),
  ('11111111-1111-4111-8111-111111111111', 2023, 370748, 361837,    8911,  16532, 339210, 232747, 'IRS Form 990 via ProPublica Nonprofit Explorer'),
  ('11111111-1111-4111-8111-111111111111', 2022, 300893, 347666,  -46773,  17912, 272437, 223836, 'IRS Form 990 via ProPublica Nonprofit Explorer'),
  ('11111111-1111-4111-8111-111111111111', 2021, 363995, 180430,  183565, 248650, 111885, 270609, 'IRS Form 990 via ProPublica Nonprofit Explorer'),
  ('11111111-1111-4111-8111-111111111111', 2020, 209970, 183374,   26596, 115481,  90369,  87044, 'IRS Form 990 via ProPublica Nonprofit Explorer'),
  ('11111111-1111-4111-8111-111111111111', 2019, 328241, 330228,   -1987,  18112, 300088,  60448, 'IRS Form 990 via ProPublica Nonprofit Explorer')
on conflict (org_id, fiscal_year) do nothing;

-- ---------------------------------------------------------------------------
-- Board of directors, as listed on the FY2024 Form 990
-- ---------------------------------------------------------------------------

insert into public.board_members (org_id, name, title, is_officer, sort_order, source) values
  ('11111111-1111-4111-8111-111111111111', 'Whitney Franklin',  'Board Chair',     true,  10, 'FY2024 IRS Form 990'),
  ('11111111-1111-4111-8111-111111111111', 'Sarah Schwering',   'Vice President',  true,  20, 'FY2024 IRS Form 990'),
  ('11111111-1111-4111-8111-111111111111', 'Gretchen Renz',     'Treasurer',       true,  30, 'FY2024 IRS Form 990'),
  ('11111111-1111-4111-8111-111111111111', 'Stephanie Brown',   'Secretary',       true,  40, 'FY2024 IRS Form 990'),
  ('11111111-1111-4111-8111-111111111111', 'Ann McKay',         'Director',        false, 50, 'FY2024 IRS Form 990'),
  ('11111111-1111-4111-8111-111111111111', 'Terrence Browne',   'Director',        false, 60, 'FY2024 IRS Form 990'),
  ('11111111-1111-4111-8111-111111111111', 'Josh Hall',         'Director',        false, 70, 'FY2024 IRS Form 990'),
  ('11111111-1111-4111-8111-111111111111', 'Brant Olson',       'Director',        false, 80, 'FY2024 IRS Form 990')
on conflict (org_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Pipeline
--
-- `eligibility` holds the funder's own words, quoted. `deadline_estimated`
-- true means the date is projected from a prior-year pattern and has NOT been
-- read off the funder's current page.
-- ---------------------------------------------------------------------------

insert into public.opportunities (
  id, org_id, funder_name, program_name, url,
  amount_min, amount_max, deadline, deadline_estimated, verified, verified_at,
  status, eligibility, notes
) values (
  '22222222-2222-4222-8222-222222222201',
  '11111111-1111-4111-8111-111111111111',
  'Spokane Arts',
  'SAGA Round 3',
  'https://spokanearts.org/saga-grants/',
  1000, 10000,
  '2026-10-01', false, true, now(),
  'prospect',
  $elig$Quoted from the Spokane Arts SAGA guidelines.

INELIGIBLE ORGANIZATIONS include:
"Organizations that require participation in religious services and/or education as a condition of receiving services"

"Groups or Individuals who have been SAGA-funded in the previous two consecutive years (regardless of round)"

UNACCEPTABLE EXPENSES include:
"Re-granting or scholarships"
"Tuition that generates credit"$elig$,
  $notes$Awards announced December 1.

CATEGORY: file under Category 2 (organizations with a budget under $500K). CYT's 2024 expenses were $432,573, which is inside that ceiling.

THE ASK: general operating support is eligible and is the right ask here. Contributions were 5.4% of revenue in 2024 ($21,025 of $391,024) -- this is an organization that earns nearly all of its money through program revenue and has thin contributed income. Operating support is both honest and the strongest case.

DO NOT REQUEST SCHOLARSHIPS. "Re-granting or scholarships" is a listed unacceptable expense, and scholarship support is the obvious thing a youth theater would ask for. Asking would disqualify the request.

RELIGIOUS PARTICIPATION TEST: the exclusion is about requiring participation in religious services or education as a condition of receiving services -- not about having a faith-based mission. [CONFIRM with staff] how CYT Spokane answers that, in their words, before submitting.

TWO-YEAR RULE: [CONFIRM] whether CYT Spokane received SAGA funding in the previous two consecutive years. Prior funding in both would make this ineligible regardless of anything else.

REQUIRED: a video work sample is required for performing arts applicants.$notes$
) on conflict (id) do nothing;

insert into public.opportunities (
  id, org_id, funder_name, program_name, url,
  amount_min, amount_max, deadline, deadline_estimated, verified,
  status, eligibility, notes
) values (
  '22222222-2222-4222-8222-222222222202',
  '11111111-1111-4111-8111-111111111111',
  'Innovia Foundation',
  'Community Grants Program',
  'https://innovia.org/apply-for-a-grant/',
  2500, 15000,
  '2027-02-05', true, false,
  'prospect',
  $elig$[CONFIRM] Eligibility language has not yet been quoted from the funder's current page. Do not summarize from memory -- open https://innovia.org/apply-for-a-grant/ and paste the funder's own words here.$elig$,
  $notes$DEADLINE IS ESTIMATED, NOT VERIFIED. The 2026 round opened December 2025, had an early-bird date of January 9, and closed February 6, 2026. The 2027-02-05 date here is projected from that pattern alone. Nobody has read it off Innovia's page.

Before this is treated as a real date: open the funder's page, confirm the 2027 cycle dates, quote the eligibility language into the eligibility field, and set verified = true. If the round has not been announced yet, leave it estimated and check again later. Do not replace the projection with a different guess.$notes$
) on conflict (id) do nothing;

insert into public.opportunities (
  id, org_id, funder_name, program_name, url,
  amount_min, amount_max, deadline, deadline_estimated, verified,
  status, eligibility, notes
) values (
  '22222222-2222-4222-8222-222222222203',
  '11111111-1111-4111-8111-111111111111',
  'Washington State Arts Commission (ArtsWA)',
  'Art Project Grant',
  'https://www.arts.wa.gov/art-project-grant/',
  1000, 3000,
  '2027-04-16', true, false,
  'prospect',
  $elig$Quoted limit from the ArtsWA Art Project Grant page:

Project support "does not fund ongoing programs."

[CONFIRM] The remainder of the eligibility language has not been quoted from the funder's current page. Open https://www.arts.wa.gov/art-project-grant/ and paste the funder's own words here before relying on this record.$elig$,
  $notes$DEADLINE IS ESTIMATED, NOT VERIFIED.

FIT: weak. This is project support, and the quoted limit is that it "does not fund ongoing programs." CYT's work is recurring seasonal sessions, which is the thing this grant explicitly does not fund. A fundable request here would have to be a genuinely distinct, time-bound project -- not the season relabeled as one.

STRUCTURE: this is a reimbursement grant. The organization spends first and is repaid. With 2024 ending at -$41,549 and net assets down to $191,198, [CONFIRM with the treasurer] that the cash-flow timing works before committing to it.

Award size is $1,000-$3,000. Weigh the staff time to apply against that.$notes$
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Answer library
--
-- Reusable blocks the drafting model is given as source material. Every
-- unknown is marked [CONFIRM: ...] on purpose. The model is instructed to
-- carry those markers through into drafts rather than filling them in.
-- ---------------------------------------------------------------------------

insert into public.answer_library (org_id, key, title, category, body, sort_order) values
(
  '11111111-1111-4111-8111-111111111111',
  'mission-history',
  'Mission and history',
  'Organization',
  $body$Christian Youth Theater - Spokane (CYT Spokane) is a 501(c)(3) nonprofit performing arts education organization founded in 1998 and granted federal tax exemption in June 2000. EIN 91-1949474. NTEE classification A60, Performing Arts. The organization operates from 3901 E. Main Ave, Suite A, Spokane, WA 99202, and is led by Executive Artistic Director Kristine Lyons.

Mission: "Christian Youth Theater develops character and creativity in kids of all ages through quality theater arts training that brings families and communities together while reflecting the Creator."

CYT Spokane is a licensed affiliate of the national CYT organization.

[CONFIRM: number of students served per session and per year]
[CONFIRM: number of productions staged per year, and recent titles]
[CONFIRM: ages served and class structure]
[CONFIRM: any notable history -- venues used, growth milestones, how the affiliate started in Spokane]$body$,
  10
),
(
  '11111111-1111-4111-8111-111111111111',
  'community-need',
  'Community need',
  'Case for support',
  $body$Frame the need around what is actually documented, not around national statistics that have not been checked against Spokane.

What is documented in CYT Spokane's own filings: the organization earns nearly all of its revenue from program fees. In 2024, program revenue was $357,885 of $391,024 in total revenue, while contributions were $21,025 -- 5.4%. An organization funded almost entirely by what families pay is, structurally, an organization whose access depends on families' ability to pay.

[CONFIRM: what arts education access in Spokane-area schools currently looks like, with a source and date -- do not cite a figure that has not been checked]
[CONFIRM: waitlist or unmet demand, if any is tracked]
[CONFIRM: what share of participating families request tuition assistance]
[CONFIRM: geographic reach -- which districts or neighborhoods participating families come from]

Do not assert a decline in school arts funding, a participation statistic, or a demographic claim about Spokane without a source. If the source cannot be produced, leave the [CONFIRM] marker in the draft.$body$,
  20
),
(
  '11111111-1111-4111-8111-111111111111',
  'who-is-served',
  'Who is served',
  'Case for support',
  $body$CYT Spokane serves children and youth in the Spokane area through theater arts training and productions, along with their families and audiences.

[CONFIRM: age range served]
[CONFIRM: number of unduplicated youth served per year]
[CONFIRM: racial, ethnic, and income demographics of participants -- and whether CYT collects this at all. If it is not collected, say so plainly in applications rather than estimating. Funders accept "we do not currently collect this" far better than a number that cannot be supported.]
[CONFIRM: number of participants receiving tuition assistance, and the total dollar value]
[CONFIRM: annual audience attendance across productions]
[CONFIRM: whether participation is open to youth of any faith or none, and in what terms staff describe that]$body$,
  30
),
(
  '11111111-1111-4111-8111-111111111111',
  'success-measures',
  'How success is measured',
  'Case for support',
  $body$[CONFIRM: what CYT Spokane actually measures today.] This entry should not be drafted from what a funder would like to hear. Before answering an evaluation question, get from staff:

[CONFIRM: what is tracked now -- enrollment, retention session to session, attendance, audition-to-cast rates, family surveys?]
[CONFIRM: whether any post-session survey of students or parents exists, and what it asks]
[CONFIRM: what outcomes staff themselves would name as the point of the program]
[CONFIRM: any longitudinal or alumni tracking]

An honest answer describing a modest, real measurement practice is stronger than an invented evaluation framework, and it is the only kind of answer that can survive a site visit or a final report.

Documented outputs that can be stated without new data collection: number of productions staged, number of enrolled participants, and number of performances -- once [CONFIRM]ed with staff records.$body$,
  40
),
(
  '11111111-1111-4111-8111-111111111111',
  'financial-position',
  'Financial position',
  'Organization',
  $body$All figures below are from IRS Form 990 filings (via ProPublica Nonprofit Explorer). Fiscal year is the calendar year.

2024: revenue $391,024; expenses $432,573; net -$41,549; contributions $21,025; program revenue $357,885; net assets $191,198
2023: revenue $370,748; expenses $361,837; net $8,911; contributions $16,532; program revenue $339,210; net assets $232,747
2022: revenue $300,893; expenses $347,666; net -$46,773; contributions $17,912; program revenue $272,437; net assets $223,836
2021: revenue $363,995; expenses $180,430; net $183,565; contributions $248,650; program revenue $111,885; net assets $270,609
2020: revenue $209,970; expenses $183,374; net $26,596; contributions $115,481; program revenue $90,369; net assets $87,044
2019: revenue $328,241; expenses $330,228; net -$1,987; contributions $18,112; program revenue $300,088; net assets $60,448

How to present this honestly:

Earned-revenue dependence. Program revenue is the overwhelming majority of income in every normal year -- 91.5% in 2024. Contributed income was 5.4% of revenue in 2024. This is the central fact of CYT Spokane's finances and the strongest argument for general operating support.

2020-2021 are pandemic years and are not a trend. Contributions of $115,481 in 2020 and $248,650 in 2021, against program revenue that collapsed to $90,369 and $111,885, reflect relief funding and emergency giving. [CONFIRM: what the 2020-2021 contributions consisted of -- PPP, Shuttered Venue Operators Grant, emergency foundation support, individual giving?] Explain these years rather than letting a reviewer read them as a fundraising capacity the organization has since lost.

The recent deficits are real: -$41,549 in 2024 and -$46,773 in 2022. Net assets fell from $232,747 at the end of 2023 to $191,198 at the end of 2024. Do not present this as a growth story. It is an organization delivering programs at roughly break-even on earned revenue with very little contributed cushion, which is precisely the situation operating support addresses.

[CONFIRM: current-year (2025 and 2026) financial position -- the most recent 990 available here is 2024]
[CONFIRM: months of operating reserve]
[CONFIRM: whether the organization has an audit or a financial review]$body$,
  50
),
(
  '11111111-1111-4111-8111-111111111111',
  'board-of-directors',
  'Board of directors',
  'Organization',
  $body$Board of directors as listed on the FY2024 IRS Form 990:

Whitney Franklin, Board Chair
Sarah Schwering, Vice President
Gretchen Renz, Treasurer
Stephanie Brown, Secretary
Ann McKay, Director
Terrence Browne, Director
Josh Hall, Director
Brant Olson, Director

Eight members, four of them officers.

Staff leadership: Kristine Lyons, Executive Artistic Director.

[CONFIRM: whether the roster has changed since the FY2024 filing]
[CONFIRM: board members' professional backgrounds and affiliations -- funders regularly ask, and this is not in the 990]
[CONFIRM: meeting frequency, and whether there is a give/get policy or 100% board giving]
[CONFIRM: committee structure]
[CONFIRM: term lengths and terms of service]

Do not describe the board's professional expertise, diversity, or governance practices without confirming them. A board list from a 990 tells you names and titles and nothing else.$body$,
  60
),
(
  '11111111-1111-4111-8111-111111111111',
  'religious-participation',
  'Religious requirement (for secular and public funders)',
  'Compliance',
  $body$This is the entry that decides eligibility with most public and secular funders, so it must be answered by staff, not drafted.

The test funders apply is not whether the mission is faith-based. It is whether religious participation is a condition of receiving services. Spokane Arts words its exclusion exactly this way: "Organizations that require participation in religious services and/or education as a condition of receiving services." Faith-rooted organizations that do not gate services on religious participation are eligible under that language; organizations that do are not.

CYT Spokane's mission ends "while reflecting the Creator." CYT National words that clause "while reflecting Jesus." Neither phrasing, by itself, answers the funder's question.

[CONFIRM with staff, in their own words, and record the answer verbatim here:]
- Is participation in religious services required for enrollment, casting, or any service?
- Is participation in religious education or devotional activity required?
- Is there a statement of faith that students, families, staff, or volunteers must sign?
- Are auditions, casting, or class placement affected by a family's faith or church attendance?
- Are youth of any faith or none welcomed and served on the same terms?

Until those are answered by staff, do not submit an application to any funder carrying this exclusion, and do not let a draft assert a compliant answer. Getting this wrong is not a lost grant -- it is a false statement on an application.$body$,
  70
)
on conflict (org_id, key) do nothing;
