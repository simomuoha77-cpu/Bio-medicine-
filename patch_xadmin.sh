#!/bin/bash
FILE="public/xadmin.html"

# 1. Add Settings nav button
sed -i 's|<button class="nl" onclick="showSec.*logs.*Activity Logs</button>|<button class="nl" onclick="showSec('\''logs'\'',this)"><i class="fa-solid fa-scroll"></i> Activity Logs</button>\n      <div class="nav-grp">Admin</div>\n      <button class="nl" onclick="showSec('\''settings'\'',this)"><i class="fa-solid fa-gear"></i> Settings</button>|' "$FILE"

# 2. Add settings to secTitles
sed -i 's|"logs":"Activity Logs"}|"logs":"Activity Logs","settings":"Settings \& Configuration"}|' "$FILE"

# 3. Add loadSettings() call in showSec function
sed -i 's|if(window.innerWidth<900) document.getElementById("sidebar").classList.remove("open");|if(window.innerWidth<900) document.getElementById("sidebar").classList.remove("open");\n  if(name==="settings") loadSettings();|' "$FILE"

# 4. Add Settings HTML section before </div><!-- /main -->
SETTINGS_HTML='
    <!-- SETTINGS -->
    <div class="sec" id="sec-settings">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
        <div class="panel">
          <div class="ph"><span class="ph-ttl"><i class="fa-solid fa-robot" style="color:var(--accent);margin-right:7px;"></i>Gemini AI Setup</span></div>
          <div class="pb">
            <div style="background:rgba(0,217,255,0.05);border:1px solid rgba(0,217,255,0.1);border-radius:10px;padding:14px;margin-bottom:18px;font-size:12px;color:var(--muted);line-height:1.7;">
              <strong style="color:var(--accent);">How to get FREE Gemini API key:</strong><br>
              1. Go to <strong style="color:var(--text);">aistudio.google.com</strong><br>
              2. Sign in with Google account<br>
              3. Click <strong style="color:var(--text);">Get API Key</strong><br>
              4. Create key, copy it, paste below
            </div>
            <div class="fg" style="margin-bottom:14px;"><label>Current Key Status</label>
              <div id="key-status" style="padding:10px 14px;background:var(--s2);border-radius:8px;font-size:12px;color:var(--muted);font-family:monospace;">Loading...</div>
            </div>
            <div class="fg" style="margin-bottom:16px;"><label>Gemini API Key</label>
              <input type="text" id="gemini-key-input" placeholder="AIzaSy...">
            </div>
            <button class="btn btn-primary" onclick="saveGeminiKey()" style="width:100%;"><i class="fa-solid fa-floppy-disk"></i> Save API Key</button>
          </div>
        </div>
        <div class="panel">
          <div class="ph"><span class="ph-ttl"><i class="fa-solid fa-lock" style="color:var(--orange);margin-right:7px;"></i>Change Admin Password</span></div>
          <div class="pb">
            <div style="background:rgba(255,159,67,0.05);border:1px solid rgba(255,159,67,0.1);border-radius:10px;padding:14px;margin-bottom:18px;font-size:12px;color:var(--muted);">
              New password saves to database. Use it on next login.
            </div>
            <div class="fg" style="margin-bottom:14px;"><label>Current Password</label><input type="password" id="curr-pwd" placeholder="Current password"></div>
            <div class="fg" style="margin-bottom:14px;"><label>New Password</label><input type="password" id="new-pwd" placeholder="Min 6 characters"></div>
            <div class="fg" style="margin-bottom:18px;"><label>Confirm New Password</label><input type="password" id="new-pwd2" placeholder="Repeat new password"></div>
            <button class="btn btn-warn" onclick="changePassword()" style="width:100%;"><i class="fa-solid fa-key"></i> Change Password</button>
          </div>
        </div>
        <div class="panel">
          <div class="ph"><span class="ph-ttl"><i class="fa-solid fa-bolt" style="color:var(--green);margin-right:7px;"></i>Daily AI Points Per User</span></div>
          <div class="pb">
            <div style="background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.1);border-radius:10px;padding:14px;margin-bottom:18px;font-size:12px;color:var(--muted);">Set how many AI questions each user gets per day. Default is 5.</div>
            <div class="fg" style="margin-bottom:18px;"><label>Points Per Day (1-100)</label><input type="number" id="ai-points-input" placeholder="5" min="1" max="100" value="5"></div>
            <button class="btn btn-success" onclick="saveAiPoints()" style="width:100%;"><i class="fa-solid fa-floppy-disk"></i> Save Points</button>
          </div>
        </div>
        <div class="panel">
          <div class="ph"><span class="ph-ttl"><i class="fa-solid fa-circle-info" style="color:var(--muted);margin-right:7px;"></i>System Info</span></div>
          <div class="pb">
            <div style="display:flex;flex-direction:column;gap:10px;">
              <div style="display:flex;justify-content:space-between;padding:11px;background:var(--s2);border-radius:8px;"><span style="font-size:12px;color:var(--muted);">AI Provider</span><span style="font-size:12px;font-weight:600;color:var(--accent);">Google Gemini 1.5 Flash</span></div>
              <div style="display:flex;justify-content:space-between;padding:11px;background:var(--s2);border-radius:8px;"><span style="font-size:12px;color:var(--muted);">Free Limit</span><span style="font-size:12px;font-weight:600;color:var(--green);">1500 req/day FREE</span></div>
              <div style="display:flex;justify-content:space-between;padding:11px;background:var(--s2);border-radius:8px;"><span style="font-size:12px;color:var(--muted);">Secret Key</span><span style="font-size:12px;font-weight:600;color:var(--orange);">Set in .env file</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
'

# Insert settings section before </div><!-- /main -->
python3 -c "
content = open('$FILE').read()
content = content.replace('  </div><!-- /main -->', '''$SETTINGS_HTML''' + '  </div><!-- /main -->')
open('$FILE','w').write(content)
print('Settings HTML added')
"

# 5. Add Settings JS before </script>
SETTINGS_JS='
async function loadSettings() {
  try {
    const r = await aFetch("/api/xadmin/settings");
    const d = await r.json();
    if(!d.success) return;
    const s = d.settings;
    const el = document.getElementById("key-status");
    if(el) { el.textContent = s.gemini_api_key ? "Key saved: "+s.gemini_api_key : "No key set yet"; el.style.color = s.gemini_api_key ? "var(--green)" : "var(--red)"; }
    if(s.daily_ai_points && document.getElementById("ai-points-input")) document.getElementById("ai-points-input").value = s.daily_ai_points;
  } catch(e) { console.error(e); }
}
async function saveGeminiKey() {
  const key = document.getElementById("gemini-key-input").value.trim();
  if(!key){ toast("Enter a Gemini API key","er"); return; }
  const r = await aFetch("/api/xadmin/settings/gemini-key",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:key})});
  const d = await r.json();
  if(d.success){ toast("Gemini API key saved!","ok"); document.getElementById("gemini-key-input").value=""; loadSettings(); }
  else toast(d.message,"er");
}
async function changePassword() {
  const curr=document.getElementById("curr-pwd").value;
  const newp=document.getElementById("new-pwd").value;
  const newp2=document.getElementById("new-pwd2").value;
  if(!curr||!newp||!newp2){ toast("All fields required","er"); return; }
  if(newp!==newp2){ toast("Passwords do not match","er"); return; }
  if(newp.length<6){ toast("Min 6 characters","er"); return; }
  const r = await aFetch("/api/xadmin/settings/change-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword:curr,newPassword:newp})});
  const d = await r.json();
  if(d.success){ toast("Password changed!","ok"); document.getElementById("curr-pwd").value=""; document.getElementById("new-pwd").value=""; document.getElementById("new-pwd2").value=""; }
  else toast(d.message,"er");
}
async function saveAiPoints() {
  const pts=parseInt(document.getElementById("ai-points-input").value);
  if(!pts||pts<1){ toast("Enter valid points","er"); return; }
  const r = await aFetch("/api/xadmin/settings/ai-points",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({points:pts})});
  const d = await r.json();
  if(d.success) toast(d.message,"ok"); else toast(d.message,"er");
}
'

python3 -c "
content = open('$FILE').read()
content = content.replace('</script>\n</body>', '''$SETTINGS_JS''' + '</script>\n</body>')
open('$FILE','w').write(content)
print('Settings JS added')
"

echo "=== DONE === Lines now: \$(wc -l < $FILE)"
