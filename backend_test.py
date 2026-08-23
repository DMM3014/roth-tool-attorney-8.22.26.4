#!/usr/bin/env python3
"""
Backend API Tests for Funding Order Compare Endpoint
Tests the new POST /api/funding-order-compare endpoint and regression checks
"""

import requests
import json
import sys

# Backend URL from frontend/.env
BASE_URL = "https://cv-craft-504.preview.emergentagent.com/api"
MASTER_PIN = "i4m07MnVDhpTYkc1giC6wWDv"

# Test results tracking
test_results = []

def log_test(test_name, passed, details=""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    result = f"{status}: {test_name}"
    if details:
        result += f"\n   Details: {details}"
    test_results.append((passed, result))
    print(result)
    print()

def get_auth_token():
    """Get bearer token using master PIN"""
    print("=" * 80)
    print("AUTHENTICATION")
    print("=" * 80)
    
    url = f"{BASE_URL}/auth/pin/verify"
    payload = {"pin": MASTER_PIN}
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        print(f"POST {url}")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            token = data.get("token")
            if token:
                print(f"✅ Successfully obtained bearer token")
                print()
                return token
            else:
                print(f"❌ No token in response: {data}")
                return None
        else:
            print(f"❌ Auth failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ Auth request failed: {e}")
        return None

def get_defaults(token):
    """Get default config from /api/defaults"""
    print("=" * 80)
    print("GET DEFAULT CONFIG")
    print("=" * 80)
    
    url = f"{BASE_URL}/defaults"
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        print(f"GET {url}")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            config = response.json()
            print(f"✅ Successfully obtained default config")
            print(f"   Config keys: {list(config.keys())}")
            print()
            return config
        else:
            print(f"❌ Failed to get defaults: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ Get defaults request failed: {e}")
        return None

def test_funding_order_compare_two_orders(token, config):
    """Test 1: Two orders"""
    print("=" * 80)
    print("TEST 1: Two Orders")
    print("=" * 80)
    
    url = f"{BASE_URL}/funding-order-compare"
    headers = {"Authorization": f"Bearer {token}"}
    orders = [
        "Cash → Taxable → IRA → Roth",
        "Cash → IRA → Taxable → Roth"
    ]
    payload = {"config": config, "orders": orders}
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        print(f"POST {url}")
        print(f"Orders: {orders}")
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("Two orders - HTTP 200", False, f"Got {response.status_code}: {response.text[:200]}")
            return
        
        data = response.json()
        print(f"Response keys: {list(data.keys())}")
        
        # Check required keys
        required_keys = ["orders", "baseline_order", "results"]
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            log_test("Two orders - Response structure", False, f"Missing keys: {missing_keys}")
            return
        
        # Check results length
        results = data.get("results", [])
        if len(results) != 2:
            log_test("Two orders - Results length", False, f"Expected 2 results, got {len(results)}")
            return
        
        # Check each result has required metric keys
        required_metrics = [
            "funding_order", "total_roth_converted", "ending_roth", "ending_taxable",
            "embedded_unrealized_gain", "step_up_value", "net_worth_at_second_death",
            "federal_estate_tax_no_trust", "after_tax_to_heirs_secure10",
            "lifetime_tax_nominal", "lifetime_tax_npv", "heir_secure10_ira_tax",
            "beneficiary_break_even_rate"
        ]
        
        for i, result in enumerate(results):
            missing_metrics = [m for m in required_metrics if m not in result]
            if missing_metrics:
                log_test(f"Two orders - Result {i} metrics", False, f"Missing metrics: {missing_metrics}")
                return
            
            # Check that metrics are numeric or null (for break-even)
            for metric in required_metrics:
                value = result[metric]
                if metric == "beneficiary_break_even_rate":
                    # Can be null
                    if value is not None and not isinstance(value, (int, float)):
                        log_test(f"Two orders - Result {i} metric types", False, 
                                f"{metric} should be numeric or null, got {type(value)}")
                        return
                elif metric == "funding_order":
                    # Should be string
                    if not isinstance(value, str):
                        log_test(f"Two orders - Result {i} metric types", False,
                                f"{metric} should be string, got {type(value)}")
                        return
                else:
                    # Should be numeric
                    if not isinstance(value, (int, float)):
                        log_test(f"Two orders - Result {i} metric types", False,
                                f"{metric} should be numeric, got {type(value)}: {value}")
                        return
        
        print(f"✅ All checks passed")
        print(f"   Results count: {len(results)}")
        print(f"   Sample metrics from result 0:")
        print(f"     - total_roth_converted: {results[0]['total_roth_converted']}")
        print(f"     - after_tax_to_heirs_secure10: {results[0]['after_tax_to_heirs_secure10']}")
        print(f"     - lifetime_tax_npv: {results[0]['lifetime_tax_npv']}")
        
        log_test("Two orders - HTTP 200 with correct structure and metrics", True,
                f"2 results returned with all required numeric metrics")
        
    except Exception as e:
        log_test("Two orders", False, f"Request failed: {e}")

def test_funding_order_compare_three_orders(token, config):
    """Test 2: Three orders - verify metrics differ"""
    print("=" * 80)
    print("TEST 2: Three Orders - Verify Metrics Differ")
    print("=" * 80)
    
    url = f"{BASE_URL}/funding-order-compare"
    headers = {"Authorization": f"Bearer {token}"}
    orders = [
        "Cash → Taxable → IRA → Roth",
        "Cash → IRA → Taxable → Roth",
        "Split IRA & Taxable"
    ]
    payload = {"config": config, "orders": orders}
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        print(f"POST {url}")
        print(f"Orders: {orders}")
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("Three orders - HTTP 200", False, f"Got {response.status_code}: {response.text[:200]}")
            return
        
        data = response.json()
        results = data.get("results", [])
        
        if len(results) != 3:
            log_test("Three orders - Results length", False, f"Expected 3 results, got {len(results)}")
            return
        
        # Check that metrics DIFFER across the three orders
        # Compare total_roth_converted and after_tax_to_heirs_secure10
        roth_converted_values = [r["total_roth_converted"] for r in results]
        heirs_values = [r["after_tax_to_heirs_secure10"] for r in results]
        
        print(f"✅ Got 3 results")
        print(f"   Metric comparison across orders:")
        print(f"   total_roth_converted: {roth_converted_values}")
        print(f"   after_tax_to_heirs_secure10: {heirs_values}")
        
        # Check if all values are identical (they shouldn't be)
        if len(set(roth_converted_values)) == 1 and len(set(heirs_values)) == 1:
            log_test("Three orders - Metrics differ", False,
                    "All metrics are identical across orders - funding order not affecting projection")
            return
        
        # At least one metric should differ
        if len(set(roth_converted_values)) > 1 or len(set(heirs_values)) > 1:
            print(f"✅ Metrics differ across orders (funding order affects projection)")
            log_test("Three orders - Metrics differ across orders", True,
                    f"total_roth_converted varies: {roth_converted_values}, after_tax_to_heirs varies: {heirs_values}")
        else:
            log_test("Three orders - Metrics differ", False,
                    "Metrics don't vary enough across orders")
        
    except Exception as e:
        log_test("Three orders", False, f"Request failed: {e}")

def test_funding_order_invalid_duplicate(token, config):
    """Test 3: Invalid/duplicate orders should be cleaned"""
    print("=" * 80)
    print("TEST 3: Invalid/Duplicate Orders - Should Clean and Return Valid")
    print("=" * 80)
    
    url = f"{BASE_URL}/funding-order-compare"
    headers = {"Authorization": f"Bearer {token}"}
    orders = [
        "Cash → Taxable → IRA → Roth",
        "Cash → Taxable → IRA → Roth",  # Duplicate
        "bogus order"  # Invalid
    ]
    payload = {"config": config, "orders": orders}
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        print(f"POST {url}")
        print(f"Orders: {orders}")
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("Invalid/duplicate orders - HTTP 200", False, f"Got {response.status_code}: {response.text[:200]}")
            return
        
        data = response.json()
        results = data.get("results", [])
        
        print(f"✅ Got HTTP 200")
        print(f"   Results count: {len(results)}")
        
        # Should have cleaned to 1 unique valid order
        if len(results) == 1:
            print(f"✅ Correctly cleaned to 1 unique valid order")
            log_test("Invalid/duplicate orders - Cleaning works", True,
                    f"Cleaned duplicates and invalid orders, returned 1 valid result")
        else:
            log_test("Invalid/duplicate orders - Cleaning", False,
                    f"Expected 1 result after cleaning, got {len(results)}")
        
    except Exception as e:
        log_test("Invalid/duplicate orders", False, f"Request failed: {e}")

def test_funding_order_empty_orders(token, config):
    """Test 4: Empty orders should fall back to defaults"""
    print("=" * 80)
    print("TEST 4: Empty Orders - Should Fall Back to Defaults")
    print("=" * 80)
    
    url = f"{BASE_URL}/funding-order-compare"
    headers = {"Authorization": f"Bearer {token}"}
    orders = []
    payload = {"config": config, "orders": orders}
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        print(f"POST {url}")
        print(f"Orders: {orders}")
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("Empty orders - HTTP 200", False, f"Got {response.status_code}: {response.text[:200]}")
            return
        
        data = response.json()
        results = data.get("results", [])
        
        print(f"✅ Got HTTP 200")
        print(f"   Results count: {len(results)}")
        
        # Should fall back to 2 default orders
        if len(results) == 2:
            print(f"✅ Correctly fell back to 2 default orders")
            log_test("Empty orders - Fallback to defaults", True,
                    f"Empty orders array fell back to 2 default orders")
        else:
            log_test("Empty orders - Fallback", False,
                    f"Expected 2 results (default orders), got {len(results)}")
        
    except Exception as e:
        log_test("Empty orders", False, f"Request failed: {e}")

def test_funding_order_no_auth():
    """Test 5: No auth should return 401/403"""
    print("=" * 80)
    print("TEST 5: No Auth - Should Return 401 or 403")
    print("=" * 80)
    
    url = f"{BASE_URL}/funding-order-compare"
    # No Authorization header
    orders = ["Cash → Taxable → IRA → Roth"]
    payload = {"config": {}, "orders": orders}
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        print(f"POST {url}")
        print(f"No Authorization header")
        print(f"Status: {response.status_code}")
        
        if response.status_code in [401, 403]:
            print(f"✅ Correctly rejected with {response.status_code}")
            log_test("No auth - Returns 401/403", True,
                    f"Endpoint correctly rejected unauthenticated request with {response.status_code}")
        else:
            log_test("No auth - Should reject", False,
                    f"Expected 401 or 403, got {response.status_code}")
        
    except Exception as e:
        log_test("No auth", False, f"Request failed: {e}")

def test_projection_regression(token, config):
    """Regression test: POST /api/projection should return ending_taxable_basis"""
    print("=" * 80)
    print("REGRESSION TEST: POST /api/projection - ending_taxable_basis")
    print("=" * 80)
    
    url = f"{BASE_URL}/projection"
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"config": config}
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        print(f"POST {url}")
        print(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("Projection regression - HTTP 200", False, f"Got {response.status_code}: {response.text[:200]}")
            return
        
        data = response.json()
        print(f"✅ Got HTTP 200")
        
        # Check for summary.ending_taxable_basis
        summary = data.get("summary", {})
        if "ending_taxable_basis" not in summary:
            log_test("Projection regression - ending_taxable_basis", False,
                    f"summary.ending_taxable_basis not found. Summary keys: {list(summary.keys())}")
            return
        
        ending_taxable_basis = summary["ending_taxable_basis"]
        if not isinstance(ending_taxable_basis, (int, float)):
            log_test("Projection regression - ending_taxable_basis type", False,
                    f"ending_taxable_basis should be numeric, got {type(ending_taxable_basis)}: {ending_taxable_basis}")
            return
        
        print(f"✅ summary.ending_taxable_basis found: {ending_taxable_basis}")
        log_test("Projection regression - ending_taxable_basis present", True,
                f"summary.ending_taxable_basis = {ending_taxable_basis}")
        
    except Exception as e:
        log_test("Projection regression", False, f"Request failed: {e}")

def main():
    """Run all tests"""
    print("\n")
    print("=" * 80)
    print("BACKEND API TESTS: Funding Order Compare Endpoint")
    print("=" * 80)
    print()
    
    # Get auth token
    token = get_auth_token()
    if not token:
        print("❌ FATAL: Could not obtain auth token. Aborting tests.")
        sys.exit(1)
    
    # Get default config
    config = get_defaults(token)
    if not config:
        print("❌ FATAL: Could not obtain default config. Aborting tests.")
        sys.exit(1)
    
    # Run all tests
    test_funding_order_compare_two_orders(token, config)
    test_funding_order_compare_three_orders(token, config)
    test_funding_order_invalid_duplicate(token, config)
    test_funding_order_empty_orders(token, config)
    test_funding_order_no_auth()
    test_projection_regression(token, config)
    
    # Summary
    print("\n")
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    passed = sum(1 for p, _ in test_results if p)
    total = len(test_results)
    
    for _, result in test_results:
        print(result)
    
    print()
    print(f"TOTAL: {passed}/{total} tests passed")
    print("=" * 80)
    
    if passed == total:
        print("✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        print(f"❌ {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
