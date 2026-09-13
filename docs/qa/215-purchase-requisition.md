<!-- @author Wichit Wongta -->
<!-- @since 2026-09-13 -->

# Purchase Requisition (#215) — connected acceptance

Candidate: `e2c0e0c` (round one `a48e752`). Connected checks used the explicitly authorized
Teibto sandbox (`4089685_SB2`, Administrator) through an owned shared-coordinator browser tab.
Private record values, screenshots, PDFs and deployment logs stay in local evidence and are not
committed; the requisition used is a sandbox test document (internal id 1264379) whose requester is
an internal test employee.

## Reference

The legacy Suitelet `PFTS_PurchaseRequisition` (script 1492) was rendered for the same record
and used as the layout reference: bordered title box with copy label, Tax ID/Branch block, 8-row
document info table (Doc No., Date, Department, Location, Requester, E-mail, Tel., Currency),
ประเภท / เหตุผลในการขอซื้อ check rows, 8-column item table, Remark box with Base Amount / VAT /
Grand Total, three signature lines and a Created By / Printed Date / Page footer, two copies
(ต้นฉบับ / สำเนา).

## Deployment and readback

`scripts/deploy.sh` deployed the full candidate twice; `?action=version` read back `a48e752` and
then `e2c0e0c`. The canonical master was saved unchanged as template record 52, default for
`purchaserequisition`, with a two-copy set (version 1 → 2 across the rounds).

## Results

1. **Print button** — the requisition record now shows Print PDF / Download PDF / Design PDF next
   to the legacy print button (UE deployment `customdeploy_pld_ue_btn_purchreq`).
2. **Render** — `action=render` returned `%PDF-` for the requisition: 10 pages = 5 per copy, both
   copy labels correct, header/info table/check rows repeated on every page, all 63 lines printed
   once and in order with quantity, unit, unit price and line total, Thai glyphs readable.
3. **Header aliases** — requester name, e-mail, telephone, location and currency symbol print from
   the new aliases; department is blank exactly as on the record and the legacy print.
4. **Totals** — round one printed 0.00 because the record type has no `subtotal` body field and no
   statutory summary rows. After deriving the base from the body `total` net of `taxtotal`, Base
   Amount / VAT / Grand Total match the legacy print to the cent; the remark text matches.
5. **Shared query regression** — an existing invoice (template 19) still renders after the header
   and line SuiteQL changes (entity e-mail/phone subqueries, `expectedreceiptdate`).
6. **Latency (one run each, cold → warm)** — requisition 18.9 s → 12.4 s; invoice 11.2 s → 4.6 s.
   Observations only, not an SLO.

## Known differences and open items

- Expected receipt date column is blank on this record (lines carry none); the alias is proven only
  by unit tests with a stubbed `TO_CHAR` value.
- Row density differs (13 rows/page vs 10 on the legacy form) and the signature block can land on
  the page after the totals when the last page is full.
- Batch print `MONEY_TYPES` still excludes the type; the `total` search column is unproven.
- Restricted-role visibility of the requester's employee row (blank e-mail/phone, not an error)
  was not tested.
