import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, money, signedMoney } from "@/lib/format";
import type { BoardMember, Org, OrgFinancial } from "@/lib/types";

export const metadata: Metadata = { title: "Organization · Grantboard" };

export default async function OrgPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [orgResult, financialsResult, boardResult] = await Promise.all([
    supabase.from("orgs").select("*").eq("id", session.orgId).maybeSingle<Org>(),
    supabase
      .from("org_financials")
      .select("*")
      .eq("org_id", session.orgId)
      .order("fiscal_year", { ascending: false }),
    supabase
      .from("board_members")
      .select("*")
      .eq("org_id", session.orgId)
      .order("sort_order", { ascending: true }),
  ]);

  const org = orgResult.data;
  const financials = (financialsResult.data ?? []) as OrgFinancial[];
  const board = (boardResult.data ?? []) as BoardMember[];

  if (!org) {
    return (
      <div className="empty">
        <p>No organization profile found.</p>
      </div>
    );
  }

  const address = [
    org.address_line1,
    org.address_line2,
    [org.city, org.state].filter(Boolean).join(", "),
    org.postal_code,
  ]
    .filter(Boolean)
    .join(" · ");

  const mostRecent = financials[0];
  const contributedShare =
    mostRecent && mostRecent.revenue && mostRecent.contributions
      ? (Number(mostRecent.contributions) / Number(mostRecent.revenue)) * 100
      : null;

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Organization</p>
        <h1>{org.name}</h1>
        <p className="lede">
          The facts a funder asks for on every application, kept in one place so
          nobody retypes them from memory.
        </p>
      </div>

      <div className="panel">
        <h2>Identity</h2>
        <dl className="facts">
          <div>
            <dt>Legal name</dt>
            <dd>{org.legal_name ?? org.name}</dd>
          </div>
          <div>
            <dt>EIN</dt>
            <dd>{org.ein ?? "—"}</dd>
          </div>
          <div>
            <dt>Tax status</dt>
            <dd>
              {org.tax_exempt_status ?? "—"}
              {org.exemption_issued_on
                ? ` · exemption issued ${formatDate(org.exemption_issued_on)}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>NTEE code</dt>
            <dd>
              {org.ntee_code ?? "—"}
              {org.ntee_label ? ` · ${org.ntee_label}` : ""}
            </dd>
          </div>
          <div>
            <dt>Founded</dt>
            <dd>{org.founded_year ?? "—"}</dd>
          </div>
          <div>
            <dt>Fiscal year</dt>
            <dd>{org.fiscal_year_type ?? "—"}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{address || "—"}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{org.phone ?? "—"}</dd>
          </div>
          <div>
            <dt>Website</dt>
            <dd>
              {org.website ? (
                <a href={org.website} target="_blank" rel="noreferrer">
                  {org.website}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Executive leadership</dt>
            <dd>
              {org.executive_name ?? "—"}
              {org.executive_title ? `, ${org.executive_title}` : ""}
            </dd>
          </div>
        </dl>
      </div>

      <div className="section-rule">
        <h2>Mission</h2>
      </div>

      {org.mission ? (
        <blockquote className="quoted">
          {org.mission}
          <span className="quoted-source">
            The organization&rsquo;s mission statement, as adopted.
          </span>
        </blockquote>
      ) : null}

      {org.mission_notes ? (
        <div className="banner banner--info" style={{ marginTop: "1rem" }}>
          <h2>How funders read this</h2>
          <p className="prewrap">{org.mission_notes}</p>
        </div>
      ) : null}

      <div className="section-rule">
        <h2>Form 990 history</h2>
      </div>

      {financials.length === 0 ? (
        <div className="empty">
          <p>No financial history recorded.</p>
        </div>
      ) : (
        <div className="panel">
          {contributedShare !== null && mostRecent ? (
            <p className="small muted">
              In {mostRecent.fiscal_year}, contributions were{" "}
              <strong>{contributedShare.toFixed(1)}%</strong> of revenue
              ({money(Number(mostRecent.contributions))} of{" "}
              {money(Number(mostRecent.revenue))}). This organization is funded
              almost entirely by program revenue, which is the strongest
              argument for general operating support.
            </p>
          ) : null}

          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">
                Form 990 financial history by fiscal year
              </caption>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Revenue</th>
                  <th scope="col">Expenses</th>
                  <th scope="col">Net</th>
                  <th scope="col">Contributions</th>
                  <th scope="col">Program revenue</th>
                  <th scope="col">Net assets</th>
                </tr>
              </thead>
              <tbody>
                {financials.map((row) => {
                  const net = row.net === null ? null : Number(row.net);
                  return (
                    <tr key={row.id}>
                      <th scope="row">{row.fiscal_year}</th>
                      <td>{money(Number(row.revenue))}</td>
                      <td>{money(Number(row.expenses))}</td>
                      <td className={net !== null && net < 0 ? "neg" : undefined}>
                        {signedMoney(net)}
                      </td>
                      <td>{money(Number(row.contributions))}</td>
                      <td>{money(Number(row.program_revenue))}</td>
                      <td>{money(Number(row.net_assets))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="hint">
            Source: {financials[0]?.source ?? "IRS Form 990"}. The 2020 and 2021
            years reflect pandemic relief funding and are not a fundraising
            trend — explain them rather than letting a reviewer read them as
            capacity the organization has since lost.
          </p>
        </div>
      )}

      <div className="section-rule">
        <h2>Board roster</h2>
      </div>

      {board.length === 0 ? (
        <div className="empty">
          <p>No board members recorded.</p>
        </div>
      ) : (
        <div className="panel">
          <ul className="roster">
            {board.map((member) => (
              <li key={member.id} className={member.is_officer ? "is-officer" : ""}>
                <span>{member.name}</span>
                <span className="roster-title">{member.title ?? "Director"}</span>
              </li>
            ))}
          </ul>
          <p className="hint">
            Source: {board[0]?.source ?? "organization records"}. A 990 roster
            gives names and titles only — confirm current membership and
            professional backgrounds with staff before citing them.
          </p>
        </div>
      )}
    </>
  );
}
