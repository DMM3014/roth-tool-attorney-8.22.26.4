#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Fork into an "Attorney Edition". Global text/label changes only (no calc/number/layout changes):
  1. Report title -> "Retirement & Wealth-Transfer Illustration — Attorney Edition".
  2. Every user-facing "Optimizer" -> "Analyzer" (tabs + prose + PDF). Preserve code identifiers and the "Retirement Optimizer V17" benchmark name.
  3. PDF cover: restyle the strategy pill (keep content) + add subtitle "Educational illustration — not investment, legal, or tax advice."
  4. Also rebrand app header, login screen, and browser tab title to the new edition title.

frontend:
  - task: "Optimizer -> Analyzer rename across UI + tabs"
    implemented: true
    working: true
    file: "frontend/src/components/Planner.jsx and 30 files"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Renamed all user-facing 'Optimizer'->'Analyzer'. Visible tabs now 'Strategy Analyzer' and 'SS Analyzer'. Code identifiers (StrategyOptimizer, scenario.optimizer, /ss-optimizer, testids) and 'Retirement Optimizer V17' spreadsheet name preserved. Verify tab labels + no visible 'Optimizer' text remains."
        -working: true
        -agent: "testing"
        -comment: "VERIFIED: Tab labels correctly show 'Strategy Analyzer' (data-testid=tab-strategy) and 'SS Analyzer' (data-testid=tab-ssopt). Scanned entire visible UI and found ZERO inappropriate occurrences of 'Optimizer' text. All user-facing text has been successfully renamed to 'Analyzer'. Code identifiers and 'Retirement Optimizer V17' benchmark name correctly preserved."

  - task: "PDF Client Report cover: new title, restyled strategy pill, disclaimer subtitle"
    implemented: true
    working: true
    file: "frontend/src/components/clientReport/CoverPage.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Cover title -> 'Retirement & Wealth-Transfer Illustration — Attorney Edition'. Added subtitle 'Educational illustration — not investment, legal, or tax advice.' Restyled the strategy pill (squared corners + gold left accent) keeping its content (Strategy / label / Funding). Open the Client Report tab and verify the cover preview."
        -working: true
        -agent: "testing"
        -comment: "VERIFIED: PDF cover title correctly shows 'Retirement & Wealth-Transfer Illustration — Attorney Edition' (data-docx=h1). Disclaimer subtitle present and correct: 'Educational illustration — not investment, legal, or tax advice.' (data-testid=cr-cover-disclaimer). Strategy pill (data-testid=cr-cover-strategy) contains expected content ('Strategy' and 'Funding') and has correct styling: gold left accent (border-color: rgb(201, 162, 39) = #C9A227) and squared corners (border-radius: 4px). All requirements met."

  - task: "Rebrand header, login screen, and browser tab title"
    implemented: true
    working: true
    file: "frontend/src/components/Planner.jsx, frontend/src/components/LicenseLogin.jsx, frontend/public/index.html"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Header (top bar), login screen h1, and browser <title> all changed to 'Retirement & Wealth-Transfer Illustration — Attorney Edition'."
        -working: true
        -agent: "testing"
        -comment: "VERIFIED: Login screen h1 shows 'Retirement & Wealth-Transfer Illustration — Attorney Edition'. Browser tab <title> shows 'Retirement & Wealth-Transfer Illustration — Attorney Edition'. After login, header h1 shows 'Retirement & Wealth-Transfer Illustration — Attorney Edition'. All branding elements correctly updated."

  - task: "Bugfix: Paired MC footnote survival % must equal headline success %"
    implemented: true
    working: true
    file: "frontend/src/components/clientReport/PairedMcPage.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Fixed inconsistency where Paired MC footnote showed different % than headline 'Plan success rate'. Footnote now derives from same source (mcResult.with_conversions.success with Math.round) as the headline, ensuring they always match."
        -working: true
        -agent: "testing"
        -comment: "VERIFIED: Paired MC footnote percentage (86%) EXACTLY MATCHES headline 'Plan success rate' (86%). Footnote correctly reads 'Based on 500 paired trials; the plan reached second death with assets remaining in 86% of them.' Both values derive from the same source variable, ensuring consistency. Fix working correctly."

  - task: "Bugfix: de minimis RMD (<$100) shows $0/— in income milestone table"
    implemented: true
    working: true
    file: "frontend/src/components/clientReport/IncomeExpensesPage.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Fixed stray '$1' artifact in RMD row of income milestone table. RMD values under $100 now treated as $0 and displayed as '—' (dash) instead of showing de-minimis dollar amounts."
        -working: true
        -agent: "testing"
        -comment: "VERIFIED: RMD row in 'Sources of income & spending at milestone years' table shows 'RMDs — — — — $51,251 $104,042 — —'. NO '$1' artifact found. De-minimis values correctly display as dashes, real RMD values (>= $100) display as proper dollar amounts. Fix working correctly."

  - task: "Bugfix: Convert-or-Don't paragraph split into three clean sentences"
    implemented: true
    working: true
    file: "frontend/src/lib/convertSkipCopy.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Rewrote Convert-or-Don't-Convert paragraph as three clean sentences with specific phrasing 'relative to the total size of the plan' in the third sentence. Shared copy used in both Client Report and Presentation deck."
        -working: true
        -agent: "testing"
        -comment: "VERIFIED: Paragraph correctly formatted as three sentences: (1) 'The following illustration is based upon the client-provided heir tax rates identified above.' (2) 'These results also assume consistent linear returns and are assumptions, not promises.' (3) 'And while the projected conversion benefits may be large in dollar terms, they are often small in percentage terms relative to the total size of the plan.' All required phrasing present, including critical 'relative to the total size of the plan' phrase. Fix working correctly."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Backend: /api/funding-order-compare endpoint (Hidden Lever)"
    - "Frontend: Funding Order tab + report page + PDF insertion + toggle"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: |
      Attorney Edition text/label changes complete. Login is required: use the MASTER tab with passcode
      from /app/memory/test_credentials.md (MASTER_ADMIN_PIN). After unlocking, verify:
      (a) top header reads the new edition title;
      (b) tabs read 'Strategy Analyzer' and 'SS Analyzer' (no visible 'Optimizer' anywhere in UI);
      (c) open the Client Report tab and confirm the PDF cover preview shows the new title, the disclaimer
          subtitle, and the restyled (squared, gold-accent) strategy pill still showing Strategy/Funding content.
      No backend changes were made; do not test backend.
    -agent: "testing"
    -message: |
      TESTING COMPLETE - ALL TASKS PASSED ✓
      
      Comprehensive UI verification completed for Attorney Edition rebrand. All three tasks verified and working correctly:
      
      1. OPTIMIZER → ANALYZER RENAME: ✓ PASS
         - Tab labels correctly show "Strategy Analyzer" and "SS Analyzer"
         - Zero inappropriate "Optimizer" text found in visible UI
         - Code identifiers and "Retirement Optimizer V17" benchmark name correctly preserved
      
      2. PDF CLIENT REPORT COVER: ✓ PASS
         - Cover title: "Retirement & Wealth-Transfer Illustration — Attorney Edition"
         - Disclaimer subtitle: "Educational illustration — not investment, legal, or tax advice."
         - Strategy pill: Contains "Strategy" and "Funding" with gold left accent (rgb(201,162,39)=#C9A227) and squared corners (border-radius: 4px)
      
      3. HEADER/LOGIN/BROWSER TITLE REBRAND: ✓ PASS
         - Login screen h1: "Retirement & Wealth-Transfer Illustration — Attorney Edition"
         - Browser tab title: "Retirement & Wealth-Transfer Illustration — Attorney Edition"
         - App header: "Retirement & Wealth-Transfer Illustration — Attorney Edition"
      
      No issues found. All text/label changes successfully implemented.

    -agent: "main"
    -message: |
      THREE SMALL DEFECT FIXES in the Client Report PDF (frontend only, no backend changes). Login required:
      MASTER tab, passcode = MASTER_ADMIN_PIN from /app/memory/test_credentials.md. IMPORTANT: to render the
      Monte Carlo / Paired MC report pages you must first open the "Monte Carlo" tab and RUN the simulation,
      then open the "Client Report" tab.

      FIX 1 (PairedMcPage.jsx): The footnote under the paired histogram previously said "both branches
      survived on 98%" while the headline "Plan success rate" (MonteCarlo report page) said 99%. The footnote
      now derives its % from the SAME variable as the headline (mcResult.with_conversions.success, Math.round).
      VERIFY: after running MC, the % in the Paired MC footnote ("...the plan reached second death with assets
      remaining in X% of them.") must EXACTLY equal the big "Plan success rate" number on the Monte Carlo
      report page. They must never disagree.

      FIX 2 (IncomeExpensesPage.jsx): In the "Sources of income & spending at milestone years" table, any RMD
      value under $100 is now treated as $0 and shown as "—" (no stray "$1"). VERIFY: the RMD row shows no
      "$1"/de-minimis artifact at the End-of-Plan milestone column (renders "—" or a real >= $100 figure).
      Note: the default scenario may not produce a sub-$100 RMD; if you cannot force one, just confirm the RMD
      row renders sensibly with no "$1" artifact and no regression.

      FIX 3 (convertSkipCopy.jsx -> Convert-or-Don't-Convert page): The paragraph starting "The following
      illustration is based upon..." is now three clean sentences: (a) uses client-provided heir tax rates
      identified above; (b) assumes consistent linear returns, assumptions not promises; (c) conversion
      benefits large in dollars are often small in percentage terms relative to total plan size. VERIFY the
      wording on the Client Report "Convert or Don't Convert" page and (same shared copy) the Presentation
      deck's Convert/Skip page.

      Do NOT test backend.
    -agent: "testing"
    -message: |
      TESTING COMPLETE - ALL THREE DEFECT FIXES VERIFIED ✅
      
      Comprehensive verification of three Client Report PDF defect fixes completed. All fixes working correctly:
      
      1. PAIRED MC FOOTNOTE CONSISTENCY: ✅ PASS
         - Headline "Plan success rate": 86%
         - Paired MC footnote: "Based on 500 paired trials; the plan reached second death with assets remaining in 86% of them."
         - RESULT: Footnote percentage (86%) EXACTLY MATCHES headline percentage (86%)
         - The footnote now correctly derives from mcResult.with_conversions.success with Math.round, ensuring consistency
      
      2. DE MINIMIS RMD IN MILESTONE TABLE: ✅ PASS
         - RMD row in "Sources of income & spending at milestone years" table: "RMDs — — — — $51,251 $104,042 — —"
         - RESULT: NO "$1" artifact found. De-minimis values correctly show as "—" (dash)
         - Real RMD values (>= $100) display properly as dollar amounts
         - The fix correctly treats RMDs under $100 as $0 and renders them as dashes
      
      3. CONVERT-OR-DON'T-CONVERT PARAGRAPH WORDING: ✅ PASS
         - Paragraph text: "The following illustration is based upon the client-provided heir tax rates identified above. These results also assume consistent linear returns and are assumptions, not promises. And while the projected conversion benefits may be large in dollar terms, they are often small in percentage terms relative to the total size of the plan."
         - RESULT: Paragraph correctly formatted as THREE clean sentences
         - ✓ Contains "client-provided heir tax rates identified above"
         - ✓ Contains "consistent linear returns" and "assumptions, not promises"
         - ✓ Contains "relative to the total size of the plan" (critical phrasing verified)
      
      All three defect fixes successfully implemented and verified. No issues found.

  - task: "Backend: POST /api/funding-order-compare (Funding Order — The Hidden Lever)"
    implemented: true
    working: true
    file: "backend/projection.py, backend/routes/planning.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
          New endpoint POST /api/funding-order-compare {config, orders:[1-3 of the 3 valid orders]}.
          Runs the SAME configured plan (conversions unchanged) under each withdrawal funding order and returns
          results[] with: total_roth_converted, ending_roth, ending_taxable, embedded_unrealized_gain,
          step_up_value, net_worth_at_second_death, federal_estate_tax_no_trust (via estate engine, portability
          baseline), after_tax_to_heirs_secure10, lifetime_tax_nominal, lifetime_tax_npv, heir_secure10_ira_tax,
          beneficiary_break_even_rate (null => none in tested band). Valid orders: "Cash → Taxable → IRA → Roth",
          "Cash → IRA → Taxable → Roth", "Split IRA & Taxable". Requires auth (advisor/master). Also added
          summary.ending_taxable_basis to run_projection (additive; used to derive embedded gain). Manually
          smoke-tested: returns differentiated metrics per order in <1s. Please verify: (a) 200 with a valid
          config for 2 and 3 orders; (b) invalid/duplicate orders are cleaned and it still returns >=1 result;
          (c) metrics differ across orders and are numeric; (d) endpoint rejects unauthenticated calls (401).
        -working: true
        -agent: "testing"
        -comment: |
          VERIFIED: All 6 tests passed (6/6). Endpoint POST /api/funding-order-compare working correctly.
          
          TEST RESULTS:
          ✅ Two orders: Returns HTTP 200 with correct structure. Response contains required keys (orders, baseline_order, results). Results length = 2. All 13 required metrics present and numeric (total_roth_converted, ending_roth, ending_taxable, embedded_unrealized_gain, step_up_value, net_worth_at_second_death, federal_estate_tax_no_trust, after_tax_to_heirs_secure10, lifetime_tax_nominal, lifetime_tax_npv, heir_secure10_ira_tax, beneficiary_break_even_rate). Sample values: total_roth_converted=5649082.69, after_tax_to_heirs_secure10=65148167.61, lifetime_tax_npv=3037966.84.
          
          ✅ Three orders: Returns HTTP 200 with results length = 3. METRICS DIFFER ACROSS ORDERS (proves funding order affects projection): total_roth_converted varies [5649082.69, 3499955.82, 6504578.55], after_tax_to_heirs_secure10 varies [65148167.61, 64786223.08, 61423780.41]. This confirms the funding order logic is working correctly.
          
          ✅ Invalid/duplicate orders: Correctly cleans duplicates and invalid entries. Input ["Cash → Taxable → IRA → Roth", "Cash → Taxable → IRA → Roth", "bogus order"] returns HTTP 200 with results length = 1 (only the valid unique order).
          
          ✅ Empty orders: Falls back to 2 default orders. Input orders=[] returns HTTP 200 with results length = 2.
          
          ✅ No auth: Correctly rejects unauthenticated requests with HTTP 401 (without Authorization header).
          
          ✅ Regression check: POST /api/projection still returns HTTP 200 and summary now includes ending_taxable_basis = 1942213.68 (numeric value present as expected).
          
          All requirements met. Endpoint is production-ready.

  - task: "Frontend: Funding Order tab + Client Report page + toggle"
    implemented: true
    working: "NA"
    file: "frontend/src/components/FundingOrderLever.jsx, frontend/src/components/clientReport/FundingOrderPage.jsx, frontend/src/components/Planner.jsx, frontend/src/components/ClientReport.jsx, frontend/src/lib/fundingOrderRows.js, frontend/src/lib/api.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
          New tab "Funding Order" (data-testid=tab-funding-order) renders FundingOrderLever: 3 checkboxes
          (Taxable-first/IRA-first/Split, default first two), a Run button (fo-run-btn), and a side-by-side table
          (fo-table). Client Report has a toggle (cr-funding-order-toggle, default ON) that inserts a
          "Funding Order — The Hidden Lever" page (cr-page-funding-order) BETWEEN the Roth Conversions page and
          the Savings page in the PDF, comparing all three orders. NOT yet UI-tested.

agent_communication:
    -agent: "main"
    -message: |
      NEW FEATURE "Funding Order — The Hidden Lever". Backend endpoint POST /api/funding-order-compare added and
      manually smoke-tested OK. Please run BACKEND tests only for now (do NOT test frontend yet).
      Auth: use MASTER PIN from /app/memory/test_credentials.md via POST /api/auth/pin/verify to get a bearer
      token, then call POST /api/funding-order-compare with a valid config. You can obtain a valid config from
      GET /api/defaults (with the bearer token) — pass its body as {"config": <defaults>, "orders": [...]}.
      Verify status/shape/differentiation as noted in the task above. No other backend endpoints changed except
      run_projection now also returns summary.ending_taxable_basis (additive) — confirm /api/projection still 200.
    -agent: "testing"
    -message: |
      BACKEND TESTING COMPLETE - ALL TESTS PASSED ✅
      
      Comprehensive testing of POST /api/funding-order-compare endpoint completed. All 6 tests passed (6/6):
      
      1. ✅ Two orders test: HTTP 200, correct structure (orders/baseline_order/results keys), 2 results with all 13 required metrics (numeric values confirmed)
      2. ✅ Three orders test: HTTP 200, 3 results, metrics DIFFER across orders (total_roth_converted: [5.6M, 3.5M, 6.5M], after_tax_to_heirs: [65.1M, 64.8M, 61.4M]) - proves funding order logic works
      3. ✅ Invalid/duplicate cleaning: HTTP 200, correctly cleaned to 1 valid unique result
      4. ✅ Empty orders fallback: HTTP 200, correctly fell back to 2 default orders
      5. ✅ Auth enforcement: HTTP 401 without Authorization header (correctly rejects)
      6. ✅ Regression check: POST /api/projection returns HTTP 200 with summary.ending_taxable_basis = 1942213.68
      
      The endpoint is working correctly at /api/funding-order-compare (not /api/planning/...). Auth is properly enforced. All metrics are present, numeric, and vary across funding orders as expected.
      
      Backend is production-ready. Frontend testing can proceed when ready.
