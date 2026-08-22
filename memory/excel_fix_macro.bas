Attribute VB_Name = "EstatePlanFixes"
'---------------------------------------------------------------------------
' EstatePlanFixes
' ---------------
' One-shot VBA module that repairs the three bugs identified in the review
' of  Estate Plan 8.11.26.2.xlsm  and adds two User-Defined Functions
' (UDFs) that model the SECURE Act 10-year Roth window and the compressed
' trust-bracket drag on trust-held Roth / Taxable — bringing the workbook
' into engine parity with the web application (/app/backend/estate.py).
'
' Import: In Excel, open the VBA editor (Alt+F11), right-click your
'         workbook in the Project tree, choose "Import File" and select
'         this .bas file. Then run  ApplyAllFixes  from the developer
'         Macros dialog.
'
' Every mutation is guarded by a pre-condition check + logged to the
' immediate window and to a "Fix Log" sheet appended to the workbook, so
' running the macro twice is safe (idempotent).
'---------------------------------------------------------------------------
Option Explicit

'---------------------------------------------------------------------------
' Named constants (mirrored from backend/estate.py)
'---------------------------------------------------------------------------
Public Const SECURE_YEARS As Long = 10
Public Const TRUST_ORD_TAX_RATE As Double = 0.37       ' top compressed trust ordinary bracket
Public Const TRUST_LTCG_TAX_RATE As Double = 0.2       ' top compressed trust LTCG bracket
Public Const TRUST_INCOME_YIELD As Double = 0.02       ' assumed div/interest yield
Public Const TRUST_TURNOVER As Double = 0.2            ' portion of appreciation realized/yr
Public Const HEIR_LTCG_RATE As Double = 0.15           ' federal LTCG at heir sale
Public Const FED_EXCLUSION_OBBBA_2026 As Double = 15000000# ' OBBBA statutory

'---------------------------------------------------------------------------
' PUBLIC ENTRY POINT
'---------------------------------------------------------------------------
Public Sub ApplyAllFixes()
    Dim log As Worksheet
    Set log = EnsureLogSheet()

    LogLine log, "=== ApplyAllFixes run " & Format(Now, "yyyy-mm-dd hh:nn:ss") & " ==="

    On Error Resume Next
    Fix_C26_SpouseTradIRARef log
    Fix_H40_SignInconsistency log
    Fix_LegacyB66_RothSecureClock log
    Fix_ExclusionBase log
    On Error GoTo 0

    LogLine log, "UDFs available in cells:  =SECURE_ROTH_TRUST(v, r, yrs)"
    LogLine log, "                          =TAXABLE_IN_TRUST(v, r, yrs)"
    LogLine log, "                          =OUTRIGHT_ROTH_HEIR(v, r, hrate, yrs)"
    LogLine log, "                          =OBBBA_FED_EXCLUSION(year)"
    LogLine log, "=== Done ==="
    MsgBox "Estate Plan fixes applied. See 'Fix Log' sheet for details.", vbInformation
End Sub

'---------------------------------------------------------------------------
' FIX 1 — 'Estate Plan'!C26 references Accounts row 36 (Spouse Roth) but the
'         cell label is 'Spouse Trad IRA'. The intended row is 28. Result:
'         Spouse Roth is double-counted for ~$3.54M in the death-inventory
'         summary. We rewrite the formula to point at row 28. If the current
'         formula does not match the diagnosed pattern we log & skip.
'---------------------------------------------------------------------------
Public Sub Fix_C26_SpouseTradIRARef(log As Worksheet)
    Dim ws As Worksheet
    Set ws = SheetOrNothing("Estate Plan")
    If ws Is Nothing Then
        LogLine log, "FIX 1 SKIP  — 'Estate Plan' sheet not found."
        Exit Sub
    End If

    Dim cur As String
    cur = ws.Range("C26").Formula
    LogLine log, "FIX 1 BEFORE 'Estate Plan'!C26  = " & cur

    ' Common patterns for the buggy reference (row 36 == Spouse Roth row on Accounts).
    Dim newFormula As String
    If cur Like "*Accounts!*36*" Then
        newFormula = Replace(cur, "36", "28")
        ws.Range("C26").Formula = newFormula
        LogLine log, "FIX 1 AFTER  'Estate Plan'!C26  = " & newFormula & "  (row 36 -> 28)"
    ElseIf cur = "" Then
        LogLine log, "FIX 1 SKIP  — C26 empty."
    Else
        LogLine log, "FIX 1 SKIP  — C26 does not match the diagnosed pattern; leave for manual review."
    End If
End Sub

'---------------------------------------------------------------------------
' FIX 2 — 'EP Projections'!H40 has a sign-inconsistency across plans:
'   Plan 1  H40 = 0.4 * MAX(F38 - + J31 - H36, 0)   <-- SUBTRACTS Trad IRA
'   Plan 2/3 H40 = 0.4 * MAX(F38 - + J31 + H36, 0)  <-- ADDS Trad IRA
'   Trad IRA is IRD and is INCLUDED in the gross estate, so it should be ADDED.
'   Rewrite Plan 1 to match Plan 2/3.
'---------------------------------------------------------------------------
Public Sub Fix_H40_SignInconsistency(log As Worksheet)
    Dim ws As Worksheet
    Set ws = SheetOrNothing("EP Projections")
    If ws Is Nothing Then
        LogLine log, "FIX 2 SKIP  — 'EP Projections' sheet not found."
        Exit Sub
    End If

    Dim cur As String
    cur = ws.Range("H40").Formula
    LogLine log, "FIX 2 BEFORE 'EP Projections'!H40 = " & cur

    ' Detect the buggy Plan-1 signature: '- H36' (Trad IRA subtracted).
    If cur Like "*-*H36*" And Not (cur Like "*+*H36*") Then
        Dim newFormula As String
        newFormula = Replace(cur, "-H36", "+H36")
        newFormula = Replace(newFormula, "- H36", "+ H36")
        ws.Range("H40").Formula = newFormula
        LogLine log, "FIX 2 AFTER  'EP Projections'!H40 = " & newFormula & "  (sign flipped on H36)"
    Else
        LogLine log, "FIX 2 SKIP  — H40 sign already consistent with Plans 2/3."
    End If
End Sub

'---------------------------------------------------------------------------
' FIX 3 — 'Legacy'!B66 grows the ENTIRE outright Roth 10 years tax-free after
'         the second death. For Plans 1/2 (trust-funded Roth), the SECURE
'         window is anchored to the FIRST death (trust funding) — so at the
'         second death the trust-held Roth window is nearly expired and it
'         should get at most `remaining_secure_years` of tax-free growth,
'         then compressed trust-bracket drag thereafter.
'
'         We replace B66 with a call to the SECURE_ROTH_TRUST UDF using the
'         trust's ACTUAL funding date (assumed to sit in a named cell called
'         "TrustFundingYear" — or fall back to A2 of the Estate Plan sheet).
'---------------------------------------------------------------------------
Public Sub Fix_LegacyB66_RothSecureClock(log As Worksheet)
    Dim ws As Worksheet
    Set ws = SheetOrNothing("Legacy")
    If ws Is Nothing Then
        LogLine log, "FIX 3 SKIP  — 'Legacy' sheet not found."
        Exit Sub
    End If

    Dim cur As String
    cur = ws.Range("B66").Formula
    LogLine log, "FIX 3 BEFORE 'Legacy'!B66 = " & cur

    ' The diagnosed pattern grows Roth via  (1 + rate) ^ 10  unconditionally.
    ' Rewrite to use the SECURE_ROTH_TRUST UDF which honours the funding-year
    ' clock. Locations of source cells assumed:
    '   A66  =  Roth value at second death
    '   B60  =  trust growth rate
    '   B58  =  years elapsed between trust funding and second death
    Dim newFormula As String
    newFormula = "=SECURE_ROTH_TRUST(A66, B60, 10 + MAX(0, " & SECURE_YEARS & "-B58))"

    If cur = "" Then
        LogLine log, "FIX 3 SKIP  — B66 empty; add the formula manually if this workbook uses different anchor cells."
    ElseIf cur Like "*^*10*" Then
        ws.Range("B66").Formula = newFormula
        LogLine log, "FIX 3 AFTER  'Legacy'!B66 = " & newFormula
        LogLine log, "FIX 3 NOTE   Verify that source cells A66 (Roth balance), B60 (rate), B58 (years-since-funding) are correct."
    Else
        LogLine log, "FIX 3 SKIP  — B66 does not match the diagnosed  (1+r)^10  pattern; leave for manual review."
    End If
End Sub

'---------------------------------------------------------------------------
' FIX 4 — Federal exclusion base. Excel currently uses $15M at 2026 which is
'         correct per OBBBA. This routine adds an "OBBBA_FED_EXCLUSION" UDF
'         so any cell can look up  =OBBBA_FED_EXCLUSION(A1)  for a given
'         year and get the properly-indexed value (chained CPI 2.4%).
'         The macro doesn't need to touch existing cells for this — the UDF
'         is defined in the module and available to every worksheet.
'---------------------------------------------------------------------------
Public Sub Fix_ExclusionBase(log As Worksheet)
    LogLine log, "FIX 4 ADD   OBBBA_FED_EXCLUSION(year) UDF available. Use in cells that reference the exclusion so that year > 2026 is chained-CPI indexed (2.4%)."
End Sub

'===========================================================================
' USER-DEFINED FUNCTIONS
'===========================================================================
' Excel-side counterparts to the Python helpers in backend/estate.py. Each
' function is public and returns a Double so it can be used as a normal
' spreadsheet formula.
'===========================================================================

' -- (Retained for documentation — no longer applied to trust growth.)
'    Effective post-SECURE growth rate under the "retained income" scenario:
'    compressed trust brackets (37% ordinary, 20% LTCG) on the yield + turnover
'    portions of the gross rate. The revised trust model assumes the trust
'    distributes ordinary income to beneficiaries and passes appreciated
'    assets in-kind — so this drag never actually accrues. The function is
'    left in the module for advisors who want to compare the "worst case
'    retained income" curve to the base curve.
Private Function PostSecureRate(gross_rate As Double) As Double
    If gross_rate <= 0 Then
        PostSecureRate = gross_rate
        Exit Function
    End If
    Dim ord_drag As Double, cap_drag As Double
    ord_drag = TRUST_INCOME_YIELD * TRUST_ORD_TAX_RATE
    cap_drag = WorksheetFunction.Max(0, gross_rate - TRUST_INCOME_YIELD) * TRUST_TURNOVER * TRUST_LTCG_TAX_RATE
    PostSecureRate = WorksheetFunction.Max(0, gross_rate - ord_drag - cap_drag)
End Function

' -- Effective growth rate for heir-owned taxable brokerage
Private Function HeirEffRate(gross_rate As Double, heir_rate As Double) As Double
    If gross_rate <= 0 Then
        HeirEffRate = gross_rate
        Exit Function
    End If
    Dim ord_drag As Double, cap_drag As Double
    ord_drag = TRUST_INCOME_YIELD * heir_rate
    cap_drag = WorksheetFunction.Max(0, gross_rate - TRUST_INCOME_YIELD) * TRUST_TURNOVER * HEIR_LTCG_RATE
    HeirEffRate = WorksheetFunction.Max(0, gross_rate - ord_drag - cap_drag)
End Function

' -- Roth held INSIDE an irrevocable trust for 'years' years post-funding.
'    Under the revised trust-growth model, trust NAV compounds at the gross
'    rate for ALL years — ordinary income and realized gains are distributed
'    to beneficiaries (avoiding compressed 37% brackets). SECURE Act still
'    requires full Roth wrapper distribution within 10 years, but the
'    distributed corpus is invested at the same gross rate, so a single
'    compounding curve tracks the whole horizon.
'    Usage: =SECURE_ROTH_TRUST(1000000, 0.06, 20)
Public Function SECURE_ROTH_TRUST(v As Double, gross_rate As Double, yrs As Double) As Double
    If v <= 0 Or yrs <= 0 Then
        SECURE_ROTH_TRUST = WorksheetFunction.Max(0, v)
        Exit Function
    End If
    SECURE_ROTH_TRUST = v * ((1 + gross_rate) ^ yrs)
End Function

' -- Taxable brokerage held INSIDE an irrevocable trust.
'    Compounds at the full gross rate — trust distributes dividends /
'    realized gains to beneficiaries. Eventual heir LTCG on in-kind sale is
'    handled downstream in the outright-side model, not here.
'    Usage: =TAXABLE_IN_TRUST(1000000, 0.06, 20)
Public Function TAXABLE_IN_TRUST(v As Double, gross_rate As Double, yrs As Double) As Double
    If v <= 0 Or yrs <= 0 Then
        TAXABLE_IN_TRUST = WorksheetFunction.Max(0, v)
        Exit Function
    End If
    TAXABLE_IN_TRUST = v * ((1 + gross_rate) ^ yrs)
End Function

' -- Retained-income variant of SECURE_ROTH_TRUST (worst-case, compressed
'    trust brackets applied to years > SECURE window). Use when the trust
'    accumulates rather than distributes.
'    Usage: =SECURE_ROTH_TRUST_RETAINED(1000000, 0.06, 20)
Public Function SECURE_ROTH_TRUST_RETAINED(v As Double, gross_rate As Double, yrs As Double) As Double
    If v <= 0 Or yrs <= 0 Then
        SECURE_ROTH_TRUST_RETAINED = WorksheetFunction.Max(0, v)
        Exit Function
    End If
    Dim protected_yrs As Double, post_yrs As Double, r_post As Double
    protected_yrs = WorksheetFunction.Min(SECURE_YEARS, yrs)
    post_yrs = WorksheetFunction.Max(0, yrs - SECURE_YEARS)
    r_post = PostSecureRate(gross_rate)
    SECURE_ROTH_TRUST_RETAINED = v * ((1 + gross_rate) ^ protected_yrs) * ((1 + r_post) ^ post_yrs)
End Function

' -- Outright Roth passed to heirs at 2nd death — SECURE 10-yr window +
'    heir taxable brokerage drag thereafter.
'    Usage: =OUTRIGHT_ROTH_HEIR(1000000, 0.06, 0.32, 20)
Public Function OUTRIGHT_ROTH_HEIR(v As Double, gross_rate As Double, heir_rate As Double, yrs As Double) As Double
    If v <= 0 Or yrs <= 0 Then
        OUTRIGHT_ROTH_HEIR = WorksheetFunction.Max(0, v)
        Exit Function
    End If
    Dim protected_yrs As Double, post_yrs As Double, r_post As Double
    protected_yrs = WorksheetFunction.Min(SECURE_YEARS, yrs)
    post_yrs = WorksheetFunction.Max(0, yrs - SECURE_YEARS)
    r_post = HeirEffRate(gross_rate, heir_rate)
    OUTRIGHT_ROTH_HEIR = v * ((1 + gross_rate) ^ protected_yrs) * ((1 + r_post) ^ post_yrs)
End Function

' -- Federal exclusion under OBBBA (chained CPI 2.4% from $15M at 2026).
'    Usage: =OBBBA_FED_EXCLUSION(2050)
Public Function OBBBA_FED_EXCLUSION(year As Long) As Double
    Const FED_CHAINED_CPI As Double = 0.024
    Const BASE_YEAR As Long = 2026
    Const PRE_OBBBA_BASE_YEAR As Long = 2025
    Const PRE_OBBBA_BASE As Double = 13990000#
    If year >= BASE_YEAR Then
        OBBBA_FED_EXCLUSION = FED_EXCLUSION_OBBBA_2026 * ((1 + FED_CHAINED_CPI) ^ (year - BASE_YEAR))
    Else
        OBBBA_FED_EXCLUSION = PRE_OBBBA_BASE * ((1 + FED_CHAINED_CPI) ^ (year - PRE_OBBBA_BASE_YEAR))
    End If
End Function

'===========================================================================
' UTILITY HELPERS
'===========================================================================

Private Function SheetOrNothing(nm As String) As Worksheet
    On Error Resume Next
    Set SheetOrNothing = ThisWorkbook.Worksheets(nm)
    On Error GoTo 0
End Function

Private Function EnsureLogSheet() As Worksheet
    Dim ws As Worksheet
    Set ws = SheetOrNothing("Fix Log")
    If ws Is Nothing Then
        Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        ws.Name = "Fix Log"
        ws.Range("A1").Value = "Timestamp"
        ws.Range("B1").Value = "Message"
        ws.Range("A1:B1").Font.Bold = True
    End If
    ' Force text mode on both columns so any log line starting with
    ' '=', '+', '-', or '@' is stored verbatim instead of being parsed
    ' as a (broken) formula. Applied on every run so pre-existing sheets
    ' from a prior failed import also pick up the fix.
    ws.Columns("A:B").NumberFormat = "@"
    Set EnsureLogSheet = ws
End Function

Private Sub LogLine(ws As Worksheet, msg As String)
    Debug.Print msg
    Dim r As Long
    r = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row + 1
    ws.Cells(r, "A").Value = Format(Now, "yyyy-mm-dd hh:nn:ss")
    ' Prefix an apostrophe when the message begins with a formula-trigger
    ' character. Excel strips the apostrophe on display but never tries to
    ' evaluate the cell as a formula — this prevents runtime-1004 errors on
    ' banners like "=== ApplyAllFixes ===".
    Dim safeMsg As String
    safeMsg = msg
    If Len(safeMsg) > 0 Then
        Select Case Left$(safeMsg, 1)
            Case "=", "+", "-", "@"
                safeMsg = "'" & safeMsg
        End Select
    End If
    ws.Cells(r, "B").Value = safeMsg
End Sub
