(() => {
  let pending = null;
  let currentSession = null;

  function ensureGate() {
    let gate = document.getElementById('principalPinGate');
    if (gate) return gate;
    gate = document.createElement('section');
    gate.id = 'principalPinGate';
    gate.className = 'principal-pin-gate';
    gate.hidden = true;
    gate.setAttribute('aria-live', 'polite');
    gate.innerHTML = `
      <div class="principal-pin-topbar">
        <div class="principal-pin-brand"><span class="brand-mark">JA</span><div><strong>JA Group Services Ltd</strong><span>Head Office identity confirmation</span></div></div>
        <span class="version-badge">RESTRICTED</span>
      </div>
      <main class="principal-pin-stage">
        <form class="principal-pin-card" id="principalPinForm" novalidate>
          <div class="principal-pin-seal" aria-hidden="true">••••</div>
          <p class="eyebrow">Personal Head Office security control</p>
          <h1 id="principalPinTitle">Enter your Head Office PIN</h1>
          <p id="principalPinIntroduction">Microsoft sign-in has been confirmed. Enter your separate personal PIN to open the portal.</p>
          <div id="principalPinFields"></div>
          <p class="principal-pin-error" id="principalPinError" role="alert"></p>
          <button type="submit" class="button primary" id="principalPinSubmit">Continue securely</button>
          <button type="button" class="button secondary" id="principalPinSignOut">Sign out of Microsoft</button>
          <div class="principal-pin-assurance"><span>Individual PIN</span><span>Five-attempt limit</span><span>15-minute lockout</span></div>
        </form>
      </main>
      <footer class="principal-pin-footer"><span>Internal Head Office system · Authorised use only</span><span>PINs are never stored in readable form</span></footer>`;
    document.body.append(gate);
    gate.querySelector('#principalPinForm').addEventListener('submit', submitPin);
    gate.querySelector('#principalPinSignOut').addEventListener('click', signOut);
    return gate;
  }

  function fieldsFor(pin) {
    if (pin.setupRequired) {
      return `<label class="principal-pin-field"><span>Create a private four-digit PIN</span><input id="principalPinInput" name="pin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{4}" minlength="4" maxlength="4" required></label>
        <label class="principal-pin-field"><span>Confirm your PIN</span><input id="principalPinConfirm" name="confirmPin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{4}" minlength="4" maxlength="4" required></label>
        <p class="principal-pin-guidance">Use a PIN known only to you. Do not use another principal’s PIN, your phone PIN, a date of birth or the Cloudflare pepper.</p>`;
    }
    return `<label class="principal-pin-field"><span>Your four-digit PIN</span><input id="principalPinInput" name="pin" type="password" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4}" minlength="4" maxlength="4" required></label>`;
  }

  function show(session) {
    const gate = ensureGate();
    currentSession = session;
    const pin = session.pin || {};
    const setup = Boolean(pin.setupRequired);
    gate.querySelector('#principalPinTitle').textContent = setup ? 'Create your Head Office PIN' : 'Enter your Head Office PIN';
    gate.querySelector('#principalPinIntroduction').textContent = setup
      ? `${session.user?.displayName || 'Principal'}, create a PIN for your own Head Office account. Alfie’s and Jack’s PINs remain separate.`
      : `Microsoft sign-in for ${session.user?.displayName || 'this principal'} has been confirmed. Enter the personal PIN for this account.`;
    gate.querySelector('#principalPinFields').innerHTML = fieldsFor(pin);
    const error = gate.querySelector('#principalPinError');
    error.textContent = pin.locked
      ? `This PIN is temporarily locked until ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(pin.lockedUntil))}.`
      : '';
    const submit = gate.querySelector('#principalPinSubmit');
    submit.disabled = Boolean(pin.locked);
    submit.textContent = setup ? 'Create PIN and open portal' : 'Verify PIN and open portal';
    gate.hidden = false;
    document.body.classList.add('principal-pin-required');
    window.setTimeout(() => gate.querySelector('#principalPinInput')?.focus(), 0);
  }

  function hide() {
    const gate = ensureGate();
    gate.hidden = true;
    document.body.classList.remove('principal-pin-required');
  }

  async function submitPin(event) {
    event.preventDefault();
    event.stopPropagation();
    const gate = ensureGate();
    const pin = String(gate.querySelector('#principalPinInput')?.value || '');
    const confirmPin = String(gate.querySelector('#principalPinConfirm')?.value || '');
    const error = gate.querySelector('#principalPinError');
    const submit = gate.querySelector('#principalPinSubmit');
    error.textContent = '';
    if (!/^\d{4}$/.test(pin)) {
      error.textContent = 'Enter exactly four numbers.';
      return;
    }
    if (currentSession?.pin?.setupRequired && pin !== confirmPin) {
      error.textContent = 'The two PIN entries do not match.';
      return;
    }
    submit.disabled = true;
    submit.textContent = currentSession?.pin?.setupRequired ? 'Creating PIN…' : 'Checking PIN…';
    try {
      const response = await fetch('/api/auth/pin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: currentSession?.pin?.setupRequired ? 'setup' : 'verify', pin })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const problem = new Error(body.error?.message || 'The PIN could not be checked.');
        problem.code = body.error?.code;
        problem.details = body.error?.details;
        throw problem;
      }
      currentSession.pin = { ...(currentSession.pin || {}), ...(body.pin || {}), configured: true, setupRequired: false, verified: true };
      hide();
      pending?.resolve(true);
      pending = null;
    } catch (problem) {
      error.textContent = problem.message || 'The PIN could not be checked.';
      if (problem.code === 'PRINCIPAL_PIN_LOCKED') {
        currentSession.pin.locked = true;
        currentSession.pin.lockedUntil = problem.details?.lockedUntil || null;
        submit.disabled = true;
        submit.textContent = 'PIN temporarily locked';
      } else {
        submit.disabled = false;
        submit.textContent = currentSession?.pin?.setupRequired ? 'Create PIN and open portal' : 'Verify PIN and open portal';
        gate.querySelector('#principalPinInput')?.select();
      }
    }
  }

  async function signOut(event) {
    event?.preventDefault();
    event?.stopPropagation();
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}'
    }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    location.assign(body?.redirect || '/');
  }

  window.ensurePrincipalPin = async session => {
    if (!session?.authenticated) return false;
    if (!session.pin?.pepperConfigured) {
      throw new Error('Head Office PIN protection is not configured in Cloudflare. Add the encrypted PORTAL_PIN_PEPPER secret before deploying this release.');
    }
    if (session.pin.verified) return true;
    if (pending) return pending.promise;
    show(session);
    let resolve;
    const promise = new Promise(resolvePromise => {
      resolve = resolvePromise;
    });
    pending = { promise, resolve };
    return promise;
  };
})();
