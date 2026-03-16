const HuddleAnalytics = {
  user: null,
  workspace: null,
  _privateChannelCount: 0,
  _memberCount: 0,
  _messageCount: 0,
  _sessionStart: Date.now(),

  /* ── INIT ───────────────────────────────────── */
  init() {
    const u = sessionStorage.getItem('huddle_user');
    const w = sessionStorage.getItem('huddle_workspace');
    if (u) this.user = JSON.parse(u);
    if (w) {
      this.workspace = JSON.parse(w);
      this._privateChannelCount = (this.workspace.channels_list || []).filter(c => c.type === 'private').length;
      this._memberCount = parseInt(this.workspace.members) || 0;
      this._messageCount = parseInt(this.workspace.messages) || 0;
    }
    if (this.user) this._identifyUser();
    if (this.workspace) this._groupWorkspace();
  },

  /* ── IDENTIFY (user-level traits) ──────────── */
  _identifyUser() {
    const u = this.user;
    const w = this.workspace;
    const traits = {
      name:                u.name,
      email:               u.email,
      role:                u.role || 'admin',
      created_at:          u.created_at || new Date().toISOString(),
      // workspace context on the user
      workspace_id:        w ? w.id : null,
      workspace_name:      w ? w.name : null,
      plan:                w ? (w.plan || 'free') : 'free',
      // enrichment traits
      signup_method:       'email',
      is_workspace_admin:  u.role === 'admin',
      team_size:           u.team_size || null,
      company:             u.company || null,
    };
    if (typeof analytics !== 'undefined') analytics.identify(u.id, traits);
    this._log('Identify', { user_id: u.id, ...traits }, 'info');
  },

  identify(user) {
    this.user = { ...this.user, ...user };
    this._identifyUser();
  },

  _groupWorkspace() {
    const w = this.workspace;
    if (!w || !w.id) return;

    const channels = w.channels_list || [];
    const privateChannels = channels.filter(c => c.type === 'private').length;
    const publicChannels  = channels.filter(c => c.type !== 'private').length;
    const members = w.members_list || [];
    const memberCount = parseInt(w.members) || 0;
    const msgCount = parseInt(w.messages) || 0;

    // Lifecycle stage
    let lifecycle_stage = 'new';
    if (memberCount >= 50) lifecycle_stage = 'growth';
    else if (memberCount >= 10) lifecycle_stage = 'expanding';
    else if (memberCount >= 1 || channels.length >= 1) lifecycle_stage = 'activating';

    // Health score (0-100)
    let health = 0;
    if (memberCount > 0) health += 20;
    if (channels.length > 0) health += 20;
    if (msgCount > 0) health += 30;
    if (memberCount >= 5) health += 15;
    if (channels.length >= 3) health += 15;

    const traits = {
      // Identity
      name:                    w.name,
      plan:                    w.plan || 'free',
      created_at:              w.created_at || new Date().toISOString(),

      // Size & growth
      member_count:            memberCount,
      channel_count:           channels.length,
      public_channel_count:    publicChannels,
      private_channel_count:   privateChannels,
      message_count:           msgCount,

      // Engagement
      has_sent_first_message:  msgCount > 0,
      has_created_channels:    channels.length > 2,
      has_invited_team:        memberCount > 1,
      workspace_health_score:  health,

      // Lifecycle
      lifecycle_stage:         lifecycle_stage,
      is_enterprise_eligible:  memberCount >= 50,
      trial_eligible:          memberCount >= 50 && (w.plan || 'free') === 'free',

      // Risk signals
      misuse_risk:             privateChannels >= 5 ? 'high' : privateChannels >= 3 ? 'medium' : 'low',
      private_channel_ratio:   channels.length > 0 ? Math.round((privateChannels / channels.length) * 100) : 0,
      churn_risk:              (memberCount === 0 && msgCount === 0) ? 'high' : msgCount === 0 ? 'medium' : 'low',

      // Channel inventory
      channel_names:           channels.map(ch => ch.name),
      private_channel_names:   channels.filter(ch => ch.type === 'private').map(ch => ch.name),
      industry:                w.industry || null,

      // Members as traits (workspace-level view)
      member_names:            members.map(m => m.name),
      admin_email:             this.user ? this.user.email : null,
      admin_name:              this.user ? this.user.name : null,
    };

    if (typeof analytics !== 'undefined') analytics.group(w.id, traits);
    this._log('Group', { group_id: w.id, ...traits }, 'info');
  },

  /* ── RE-IDENTIFY with updated workspace traits ─ */
  _refreshProfile() {
    const w = JSON.parse(sessionStorage.getItem('huddle_workspace') || '{}');
    this.workspace = w;
    this._groupWorkspace();
  },

  /* ── PAGE ───────────────────────────────────── */
  page(name, props = {}) {
    const p = { page_name: name, url: window.location.href, referrer: document.referrer, ...props };
    if (typeof analytics !== 'undefined') analytics.page(name, p);
    this._log('Page Viewed', p, 'info');
  },

  /* ── AUTH ───────────────────────────────────── */
  userSignedUp(p) {
    this._track('User Signed Up', {
      user_id:       p.user_id,
      email:         p.email,
      name:          p.name,
      company:       p.company,
      plan:          'free',
      signup_source: p.signup_source || 'organic',
      signup_method: 'email',
    });
  },

  userLoggedIn(p) {
    this._track('User Logged In', {
      user_id:      p.user_id,
      email:        p.email,
      workspace_id: p.workspace_id,
      login_method: p.login_method || 'email',
    });
  },

  /* ── ONBOARDING ─────────────────────────────── */
  workspaceCreated(p) {
    this._track('Workspace Created', {
      workspace_id:    p.workspace_id,
      workspace_name:  p.workspace_name,
      workspace_url:   p.workspace_url || null,
      created_by:      p.created_by,
      plan:            'free',
      member_count:    1,
    });
    // Update group immediately after workspace created
    setTimeout(() => this._refreshProfile(), 100);
  },

  onboardingStepCompleted(p) {
    this._track('Onboarding Step Completed', {
      user_id:        p.user_id,
      workspace_id:   p.workspace_id,
      step:           p.step,
      step_name:      p.step_name,
      total_steps:    5,
      completion_pct: Math.round((p.step / 5) * 100),
    });
  },

  inviteSent(p) {
    this._track('Invite Sent', {
      workspace_id:       p.workspace_id,
      invited_by:         p.invited_by,
      invitee_email:      p.invitee_email,
      invite_method:      'email',
      total_invites_sent: p.total_invites_sent || 1,
    });
  },

  profileUpdated(p) {
    if (!this.user) return;
    const traits = {
      job_title:          p.job_title || null,
      timezone:           p.timezone  || null,
      preferred_language: p.language  || null,
      current_focus:      p.current_focus || null,
      profile_completion: p.completion_pct || 0,
    };
    if (typeof analytics !== 'undefined') analytics.identify(this.user.id, traits);
    this._log('Identify', { user_id: this.user.id, ...traits }, 'info');
  },

  profileCompleted(p) {
    this._track('Profile Completed', {
      user_id:        p.user_id,
      workspace_id:   p.workspace_id,
      fields_filled:  p.fields_filled,
      completion_pct: p.completion_pct,
    });
  },

  firstMessageSent(p) {
    this._messageCount++;
    this._track('First Message Sent', {
      user_id:          p.user_id,
      workspace_id:     p.workspace_id,
      channel_id:       p.channel_id,
      is_first_message: true,
    });
    setTimeout(() => this._refreshProfile(), 100);
  },

  /* ── MESSAGING ──────────────────────────────── */
  messageSent(p) {
    this._messageCount++;
    this._track('Message Sent', {
      user_id:        p.user_id,
      workspace_id:   p.workspace_id,
      channel_id:     p.channel_id,
      channel_type:   p.channel_type || 'public',
      has_attachment: p.has_attachment || false,
      message_length: p.message_length || 0,
      session_message_count: this._messageCount,
    });
  },

  channelViewed(p) {
    this._track('Channel Viewed', {
      user_id:      p.user_id,
      workspace_id: p.workspace_id,
      channel_id:   p.channel_id,
      channel_name: p.channel_name,
      channel_type: p.channel_type,
    });
  },

  /* ── CHANNELS ───────────────────────────────── */
  channelCreated(p) {
    if (p.channel_type === 'private') this._privateChannelCount++;
    const payload = {
      user_id:                        p.user_id,
      workspace_id:                   p.workspace_id,
      channel_id:                     p.channel_id,
      channel_name:                   p.channel_name,
      channel_type:                   p.channel_type,
      total_private_channels_created: this._privateChannelCount,
    };
    this._track('Channel Created', payload);
    if (p.channel_type === 'private') this._checkMisuse(p.user_id, p.workspace_id);
    setTimeout(() => this._refreshProfile(), 150);
  },

  misusePatternDetected(p) {
    this._track('Misuse Pattern Detected', {
      user_id:           p.user_id,
      workspace_id:      p.workspace_id,
      pattern_type:      'excess_private_channels',
      count:             p.count,
      threshold_hit:     p.threshold_hit,
      suggested_feature: 'threads',
    }, 'warning');
  },

  awarenessMessageSent(p) {
    this._track('Awareness Message Sent', {
      user_id:             p.user_id,
      workspace_id:        p.workspace_id,
      channel:             'email',
      message_type:        'feature_education',
      feature_highlighted: 'threads',
      trigger_count:       p.trigger_count,
    }, 'warning');
  },

  _checkMisuse(userId, workspaceId) {
    const c = this._privateChannelCount;
    const thresholds = [3, 5, 10];
    if (thresholds.includes(c)) {
      setTimeout(() => {
        this.misusePatternDetected({ user_id: userId, workspace_id: workspaceId, count: c, threshold_hit: c });
        this.awarenessMessageSent({ user_id: userId, workspace_id: workspaceId, trigger_count: c });
        window.dispatchEvent(new CustomEvent('huddle:misuse', { detail: { count: c, threshold: c } }));
      }, 400);
    }
  },

  /* ── MEMBERS / GROWTH ───────────────────────── */
  memberAdded(p) {
    this._memberCount = p.total_members;
    this._track('Member Added', {
      workspace_id:     p.workspace_id,
      added_by:         p.added_by,
      new_member_email: p.new_member_email,
      total_members:    p.total_members,
      plan:             p.plan || 'free',
    });
    this._checkGrowth(p.workspace_id, p.total_members, p.plan);
    setTimeout(() => this._refreshProfile(), 150);
  },

  seatCountUpdated(p) {
    const prev = p.previous_count || 1;
    const growth = isFinite(p.new_count / prev) ? Math.round(((p.new_count - prev) / prev) * 100) : 0;
    this._track('Workspace Seat Count Updated', {
      workspace_id:   p.workspace_id,
      previous_count: p.previous_count,
      new_count:      p.new_count,
      growth_pct:     Math.abs(growth),
    });
  },

  enterpriseDemoOffered(p) {
    this._track('Trial Eligibility Reached', {
      workspace_id:    p.workspace_id,
      triggered_by:    'seat_threshold',
      seat_count:      p.seat_count,
      plan_suggestion: 'free_30_day_trial',
      plan_at_trigger: 'free',
    }, 'success');
    window.dispatchEvent(new CustomEvent('huddle:enterprise', { detail: p }));
  },

  upgradeSignalFired(p) {
    this._track('Upgrade Signal', {
      workspace_id:    p.workspace_id,
      plan_suggestion: 'enterprise',
      price:           '$500/month',
      member_count:    p.member_count,
      trigger:         'approaching_seat_threshold',
    });
  },

  _checkGrowth(workspaceId, totalMembers, plan) {
    if (totalMembers === 50 && plan === 'free') {
      setTimeout(() => {
        this.enterpriseDemoOffered({ workspace_id: workspaceId, seat_count: totalMembers });
        window.dispatchEvent(new CustomEvent('huddle:enterprise', { detail: { seat_count: totalMembers } }));
      }, 600);
    } else if (totalMembers < 50 && totalMembers % 10 === 0 && totalMembers > 0) {
      this.upgradeSignalFired({ workspace_id: workspaceId, member_count: totalMembers });
    }
  },

  workspaceDeleted(p) {
    if (this.user) {
      const traits = {
        workspace_deleted:     true,
        had_meaningful_usage:  p.had_meaningful_usage,
        workspace_name:        p.workspace_name,
        deleted_at:            new Date().toISOString(),
        deleted_member_count:  p.members,
        deleted_channel_count: p.channels,
        deleted_message_count: p.messages,
      };
      if (typeof analytics !== 'undefined') analytics.identify(this.user.id, traits);
      this._log('Identify', { user_id: this.user.id, ...traits }, 'info');
    }

    if (!p.had_meaningful_usage) {
      this._track('Workspace Deleted No Usage', {
        workspace_id:               p.workspace_id,
        workspace_name:             p.workspace_name,
        channels:                   p.channels,
        messages:                   p.messages,
        invited_users:              p.members,
        re_engagement_email_queued: true,
        churn_risk:                 'high',
      }, 'warning');
    } else {
      this._track('Workspace Deleted With Usage', {
        workspace_id:  p.workspace_id,
        workspace_name: p.workspace_name,
        channels:      p.channels,
        messages:      p.messages,
        members:       p.members,
        churn_risk:    'medium',
      });
    }
  },

  /* ── INTERNAL ───────────────────────────────── */
  _track(name, props, dotType = 'success') {
    const payload = { ...props, timestamp: new Date().toISOString() };
    if (typeof analytics !== 'undefined') analytics.track(name, payload);
    this._log(name, props, dotType);
  },

  _log(name, props, dotType = 'success') {
    const entry = { name, props, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), dotType };
    window.__huddleEvents = window.__huddleEvents || [];
    window.__huddleEvents.unshift(entry);
    window.dispatchEvent(new CustomEvent('huddle:event', { detail: entry }));
    const style = dotType === 'warning' ? 'color:#F5A623' : dotType === 'danger' ? 'color:#FF5F5F' : dotType === 'info' ? 'color:#38BDF8' : 'color:#7B61FF';
    console.log(`%c⬡ ${name}`, `${style};font-weight:700;font-family:Poppins,sans-serif`, props);
  },
};

window.HuddleAnalytics = HuddleAnalytics;

window.showToast = function(title, msg, type = 'info', icon = null) {
  const icons = { info: 'i', success: 'ok', warning: '!', danger: 'x' };
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `
    <div class="toast-icon-wrap">${icon || icons[type]}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div>
    </div>
    <button class="toast-close" onclick="
      this.parentElement.style.animation='toastSlideOut 0.25s ease forwards';
      setTimeout(()=>this.parentElement.remove(),250)
    ">x</button>
  `;
  container.appendChild(t);
  setTimeout(() => {
    if (t.parentElement) {
      t.style.animation = 'toastSlideOut 0.25s ease forwards';
      setTimeout(() => t.remove(), 250);
    }
  }, 5000);
};

window.addSegEvent = function(entry) {
  const containers = document.querySelectorAll('.seg-log-body');
  containers.forEach(body => {
    const placeholder = body.querySelector('[data-placeholder]');
    if (placeholder) placeholder.remove();
    const dotClass = entry.dotType === 'warning' ? 'warning' : entry.dotType === 'danger' ? 'danger' : entry.dotType === 'info' ? 'info' : '';
    const propsHtml = Object.entries(entry.props)
      .filter(([k]) => k !== 'timestamp')
      .slice(0, 4)
      .map(([k, v]) => `<span class="prop-key">${k}:</span> <span class="prop-val">${typeof v === 'object' ? JSON.stringify(v) : v}</span>`)
      .join('<br/>');
    const el = document.createElement('div');
    el.className = 'seg-event';
    el.innerHTML = `
      <div class="seg-dot ${dotClass}" style="margin-top:3px"></div>
      <div>
        <div class="seg-event-name">${entry.name}</div>
        <div class="seg-event-props">${propsHtml}</div>
      </div>
      <div class="seg-event-time">${entry.time}</div>
    `;
    body.insertBefore(el, body.firstChild);
  });
};
