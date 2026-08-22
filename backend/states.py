"""Curated 50-state + DC individual income-tax reference for the planner.

Rates are APPROXIMATE 2025/2026 top-marginal individual rates (flat where the state
is flat), intended for planning — they remain user-editable in the UI. Flags:
  - is_community_property: the 9 community-property states (drives 100% first-death
    basis step-up; common-law states step up only the decedent's / joint half).
  - taxes_ss:  state taxes Social Security benefits (informational).
  - taxes_ira: state taxes Traditional IRA / retirement-plan distributions (informational;
    False for the no-income-tax states and IL / MS / PA which exempt retirement income).
"""

STATES = [
    {"code": "AL", "name": "Alabama", "rate": 0.0500, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "AK", "name": "Alaska", "rate": 0.0000, "is_community_property": False, "taxes_ss": False, "taxes_ira": False},
    {"code": "AZ", "name": "Arizona", "rate": 0.0250, "is_community_property": True, "taxes_ss": False, "taxes_ira": True},
    {"code": "AR", "name": "Arkansas", "rate": 0.0390, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "CA", "name": "California", "rate": 0.1330, "is_community_property": True, "taxes_ss": False, "taxes_ira": True},
    {"code": "CO", "name": "Colorado", "rate": 0.0440, "is_community_property": False, "taxes_ss": True, "taxes_ira": True},
    {"code": "CT", "name": "Connecticut", "rate": 0.0699, "is_community_property": False, "taxes_ss": True, "taxes_ira": True},
    {"code": "DE", "name": "Delaware", "rate": 0.0660, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "DC", "name": "District of Columbia", "rate": 0.1075, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "FL", "name": "Florida", "rate": 0.0000, "is_community_property": False, "taxes_ss": False, "taxes_ira": False},
    {"code": "GA", "name": "Georgia", "rate": 0.0499, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "HI", "name": "Hawaii", "rate": 0.1100, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "ID", "name": "Idaho", "rate": 0.0570, "is_community_property": True, "taxes_ss": False, "taxes_ira": True},
    {"code": "IL", "name": "Illinois", "rate": 0.0495, "is_community_property": False, "taxes_ss": False, "taxes_ira": False},
    {"code": "IN", "name": "Indiana", "rate": 0.0295, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "IA", "name": "Iowa", "rate": 0.0380, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "KS", "name": "Kansas", "rate": 0.0558, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "KY", "name": "Kentucky", "rate": 0.0350, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "LA", "name": "Louisiana", "rate": 0.0300, "is_community_property": True, "taxes_ss": False, "taxes_ira": True},
    {"code": "ME", "name": "Maine", "rate": 0.0715, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "MD", "name": "Maryland", "rate": 0.0575, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "MA", "name": "Massachusetts", "rate": 0.0900, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "MI", "name": "Michigan", "rate": 0.0425, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "MN", "name": "Minnesota", "rate": 0.0985, "is_community_property": False, "taxes_ss": True, "taxes_ira": True},
    {"code": "MS", "name": "Mississippi", "rate": 0.0440, "is_community_property": False, "taxes_ss": False, "taxes_ira": False},
    {"code": "MO", "name": "Missouri", "rate": 0.0470, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "MT", "name": "Montana", "rate": 0.0590, "is_community_property": False, "taxes_ss": True, "taxes_ira": True},
    {"code": "NE", "name": "Nebraska", "rate": 0.0520, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "NV", "name": "Nevada", "rate": 0.0000, "is_community_property": True, "taxes_ss": False, "taxes_ira": False},
    {"code": "NH", "name": "New Hampshire", "rate": 0.0000, "is_community_property": False, "taxes_ss": False, "taxes_ira": False},
    {"code": "NJ", "name": "New Jersey", "rate": 0.1075, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "NM", "name": "New Mexico", "rate": 0.0590, "is_community_property": True, "taxes_ss": True, "taxes_ira": True},
    {"code": "NY", "name": "New York", "rate": 0.1090, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "NC", "name": "North Carolina", "rate": 0.0399, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "ND", "name": "North Dakota", "rate": 0.0250, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "OH", "name": "Ohio", "rate": 0.0350, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "OK", "name": "Oklahoma", "rate": 0.0475, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "OR", "name": "Oregon", "rate": 0.0990, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "PA", "name": "Pennsylvania", "rate": 0.0307, "is_community_property": False, "taxes_ss": False, "taxes_ira": False},
    {"code": "RI", "name": "Rhode Island", "rate": 0.0599, "is_community_property": False, "taxes_ss": True, "taxes_ira": True},
    {"code": "SC", "name": "South Carolina", "rate": 0.0620, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "SD", "name": "South Dakota", "rate": 0.0000, "is_community_property": False, "taxes_ss": False, "taxes_ira": False},
    {"code": "TN", "name": "Tennessee", "rate": 0.0000, "is_community_property": False, "taxes_ss": False, "taxes_ira": False},
    {"code": "TX", "name": "Texas", "rate": 0.0000, "is_community_property": True, "taxes_ss": False, "taxes_ira": False},
    {"code": "UT", "name": "Utah", "rate": 0.0445, "is_community_property": False, "taxes_ss": True, "taxes_ira": True},
    {"code": "VT", "name": "Vermont", "rate": 0.0875, "is_community_property": False, "taxes_ss": True, "taxes_ira": True},
    {"code": "VA", "name": "Virginia", "rate": 0.0575, "is_community_property": False, "taxes_ss": False, "taxes_ira": True},
    {"code": "WA", "name": "Washington", "rate": 0.0000, "is_community_property": True, "taxes_ss": False, "taxes_ira": False},
    {"code": "WV", "name": "West Virginia", "rate": 0.0512, "is_community_property": False, "taxes_ss": True, "taxes_ira": True},
    {"code": "WI", "name": "Wisconsin", "rate": 0.0765, "is_community_property": True, "taxes_ss": False, "taxes_ira": True},
    {"code": "WY", "name": "Wyoming", "rate": 0.0000, "is_community_property": False, "taxes_ss": False, "taxes_ira": False},
]

STATES_BY_CODE = {s["code"]: s for s in STATES}
