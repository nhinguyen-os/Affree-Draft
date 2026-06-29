#!/usr/bin/env python3
"""Fix agent-tools.js: the replacement created duplicate/corrupted TOOLS array entries around lines 185-295."""
import re

filepath = "/home/haitran/web/one-affree/agent-server/agent-tools.js"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Find and remove the duplicated/corrupted section
# The problem is around the ]; closing of TOOLS array - there's a duplicate fragment
# Pattern: after the run_subagent tool definition ]; should close the array,
# but the edit appended duplicated pause_for_human and complete_success definitions

# Strategy: Find the run_subagent tool entry end, then find the next valid section
# The correct structure should be:
#   ... run_subagent definition ...
# ];   <-- close TOOLS array
# // FORMAT CONVERTERS section

# The corrupted part has:
# ];                           <-- from new insert (ok)
#     description:              <-- WRONG: dangling duplicate 
#       "TERMINAL ACTION..."    <-- WRONG
# ... more duplicates ...
# ];                           <-- second close

# Find the exact corrupted block to remove
bad_start = '];\n    description:\n      "TERMINAL ACTION: Tạm dừng'
bad_end = '\n];\n\n// ═══════════════════════════════════════════════════════════════════════════\n// FORMAT CONVERTERS'
good_end = '\n];\n\n// ═══════════════════════════════════════════════════════════════════════════\n// FORMAT CONVERTERS'

# Find the bad section
idx_bad = content.find(bad_start)
if idx_bad == -1:
    print("Could not find corrupted section using primary marker. Trying alternative...")
    # Try alternative: find duplicate ]; before FORMAT CONVERTERS
    marker = "// FORMAT CONVERTERS"
    idx_fmt = content.find(marker)
    if idx_fmt == -1:
        print("ERROR: Could not find FORMAT CONVERTERS section")
        exit(1)
    # Look backwards from FORMAT CONVERTERS - there should be exactly one ];
    before = content[:idx_fmt]
    # Find last ]; before it
    last_close = before.rfind('];')
    # Find second-to-last ]; 
    second_last = before.rfind('];', 0, last_close)
    if second_last == -1:
        print("Only one ]; found, structure may be ok")
    else:
        # Remove everything between second_last+2 and last_close+2
        corrupted = content[second_last+2:last_close]
        print(f"Found corrupted section ({len(corrupted)} chars):")
        print(corrupted[:200])
        content = content[:second_last+2] + content[last_close:]
        print("Fixed by removing duplicate section")
else:
    # Find where the legitimate next section starts
    idx_fmt = content.find("// FORMAT CONVERTERS", idx_bad)
    if idx_fmt == -1:
        print("ERROR: Cannot find FORMAT CONVERTERS after bad section")
        exit(1)
    # Find the ]; right before FORMAT CONVERTERS
    idx_last_close = content.rfind('];', idx_bad, idx_fmt)
    # Remove everything from bad_start to idx_last_close (inclusive) + ]; char
    content = content[:idx_bad] + content[idx_last_close:]
    print(f"Fixed by removing {idx_last_close - idx_bad} chars of corrupted content")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("Done!")
print(f"File now has {content.count(chr(10))} lines")
