// TAHA BOT - single-file bundle generated from the original modular source.
// Media V6: Openverse multi-field search, Audius CC-label support, ccMixter, and provider diagnostics.
// Keep package.json beside this file. Media files are sent only when the source permits downloading and redistribution.
'use strict';

const __nativeRequire = require;
const __path = __nativeRequire('node:path');
const __modules = {
  "index.js": function (require, module, exports) {
'use strict';

const http = require('node:http');
const { config, validateConfig } = require('./src/config');
const { Database } = require('./src/systems/database');
const { connectMessenger } = require('./src/systems/fca');
const { JobManager } = require('./src/systems/jobs');
const { startProtectionMonitor } = require('./src/systems/monitor');
const { handleIncoming } = require('./src/systems/dispatcher');
const registry = require('./src/commands');
const logger = require('./src/utils/logger');

async function main() {
  validateConfig();
  const db = new Database(process.env.DB_FILE || 'data/store.json');
  const { api, mqtt, currentUserID, saveAppState } = await connectMessenger(config);
  const jobs = new JobManager();
  const ctxState = { maxLatency: 0 };
  let connected = true;
  let stopping = false;
  const seenMessageIDs = new Map();

  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const payload = {
        service: 'TAHA BOT',
        status: connected ? 'online' : 'degraded',
        uptimeSeconds: Math.floor(process.uptime()),
        locked: Boolean(db.get('locked')),
        maintenance: Boolean(db.get('maintenance')),
      };
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(payload));
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => logger.info(`Health endpoint listening on ${port}.`));

  const stopMonitor = startProtectionMonitor({
    api, db, config, botUserID: currentUserID, primaryID: config.primaryDeveloperId,
  });

  async function onEvent(event) {
    if (stopping || !event) return;
    const messageID = event.messageID || event.mid;
    if (messageID) {
      const now = Date.now();
      if (seenMessageIDs.has(String(messageID)) && now - seenMessageIDs.get(String(messageID)) < 10000) return;
      seenMessageIDs.set(String(messageID), now);
      if (seenMessageIDs.size > 500) {
        for (const [key, time] of seenMessageIDs) if (now - time > 30000) seenMessageIDs.delete(key);
      }
    }
    await handleIncoming({
      event, api, db, config, jobs, registry, currentUserID, connected, ctxState,
    });
  }

  mqtt.on('message', event => { onEvent(event).catch(err => logger.error('Incoming message handler failed', { error: err.message })); });
  mqtt.on('message_reply', event => { onEvent(event).catch(err => logger.error('Reply handler failed', { error: err.message })); });
  mqtt.on('event', event => {
    // Thread updates are observed by the periodic reconciliation worker.
    if (event?.threadID) db.touchThread(event.threadID).catch(err => logger.warn('Could not track thread', { error: err.message }));
  });
  mqtt.on('error', err => {
    connected = false;
    const message = String(err?.message || err || 'Unknown MQTT error');
    logger.error('Messenger MQTT error', { error: message });
    if (/not logged in|login approval|review recent login|checkpoint|authentication|auth failure/i.test(message)) {
      logger.error('Facebook rejected the current session. The bot cannot safely create a replacement AppState without account-owner authentication. Review the Facebook security prompt, then replace FB_APPSTATE_JSON in Railway if required.');
    }
  });
  mqtt.on('close', () => { connected = false; logger.warn('Messenger MQTT connection closed; the adapter will attempt automatic reconnection.'); });
  mqtt.on('offline', () => { connected = false; logger.warn('Messenger MQTT is offline; waiting for the adapter to reconnect.'); });
  mqtt.on('ready', () => {
    connected = true;
    logger.info('Messenger realtime connection is ready.');
    saveAppState('mqtt-ready').catch(err => logger.warn('Could not persist AppState after Messenger became ready.', { error: err.message }));
  });

  const appStateSaveTimer = setInterval(() => {
    if (!connected || stopping) return;
    saveAppState('periodic').catch(err => logger.warn('Periodic AppState persistence failed.', { error: err.message }));
  }, config.appStateSaveIntervalMinutes * 60 * 1000);
  appStateSaveTimer.unref?.();

  logger.info('TAHA BOT started.', {
    currentUserID: currentUserID || 'unknown',
    primaryDeveloperID: config.primaryDeveloperId,
    commandCount: registry.commands.length,
    prefixes: config.prefixes,
  });

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info(`Shutting down after ${signal}.`);
    jobs.cancelAll();
    clearInterval(appStateSaveTimer);
    stopMonitor();
    await saveAppState('shutdown').catch(err => logger.warn('Could not persist AppState during shutdown.', { error: err.message }));
    await db.save().catch(() => {});
    server.close();
    try {
      if (typeof mqtt.stopListening === 'function') mqtt.stopListening();
      else if (typeof mqtt.stopListeningAsync === 'function') await mqtt.stopListeningAsync();
    } catch { /* best effort */ }
    process.exit(0);
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch(error => {
  logger.error('Fatal startup error', { error: error.message, stack: error.stack });
  process.exit(1);
});

  },
  "src/commands/advanced.js": function (require, module, exports) {
'use strict';

const os = require('node:os');
const { frame, success, error } = require('../utils/format');
const { apiCall } = require('../systems/fca');

module.exports = [
  {
    name: 'health', aliases: ['صحة'], category: 'advanced', usage: '.health',
    summary: { en: 'Runtime health and resources' }, description: { ar: 'يعرض الذاكرة والمعالج ومدة التشغيل ومعلومات بيئة الاستضافة.', en: 'Shows memory, CPU, uptime and runtime environment.' },
    handler: async ctx => {
      const mem = process.memoryUsage();
      const total = os.totalmem();
      const free = os.freemem();
      const fmt = n => `${(n / 1024 / 1024).toFixed(1)} MB`;
      return ctx.reply(frame('𝖧𝖾𝖺𝗅𝗍𝗁 ᚲ', `Status : HEALTHY\nNode.js : ${process.version}\nPlatform : ${process.platform} / ${process.arch}\nCPU cores : ${os.cpus().length}\nProcess RAM : ${fmt(mem.rss)}\nHeap used : ${fmt(mem.heapUsed)}\nSystem RAM : ${fmt(total - free)} / ${fmt(total)}\nUptime : ${Math.floor(process.uptime())} sec`));
    },
  },
  {
    name: 'net', aliases: ['نت'], category: 'advanced', usage: '.net',
    summary: { en: 'Network responsiveness check' }, description: { ar: 'يقيس زمن استجابة واجهة Messenger؛ لا يدّعي قياس سرعة التنزيل الفعلية.', en: 'Measures Messenger API response latency; it does not claim to measure full download bandwidth.' },
    handler: async ctx => {
      const start = Date.now(); await apiCall(ctx.api, 'getThreadInfo', ctx.threadID); const ms = Date.now() - start;
      return ctx.reply(frame('𝖭𝖾𝗍𝗐𝗈𝗋𝗄 ᚲ', `Messenger API latency : ${ms} ms\nConnection : ONLINE\nNetwork throughput : Not measured`));
    },
  },
  {
    name: 'clean', aliases: ['cln', 'حذف', 'مسح'], category: 'advanced', usage: '.clean (reply to a bot message)',
    summary: { en: 'Unsend a bot message' }, description: { ar: 'يحذف رسالة البوت التي رددت عليها إذا كانت من الحساب نفسه.', en: 'Unsends the bot message you replied to, when the platform permits it.' },
    handler: async ctx => {
      const reply = ctx.event?.messageReply || ctx.event?.replyMessage;
      if (!reply?.messageID) return ctx.reply(error('Reply directly to a message sent by TAHA BOT.'));
      if (reply.senderID && String(reply.senderID) !== String(ctx.currentUserID)) return ctx.reply(error('I can only unsend my own messages.'));
      await apiCall(ctx.api, 'unsendMessage', reply.messageID);
      return ctx.reply(success('Bot message removed'));
    },
  },
  {
    name: 'typing', aliases: [], category: 'advanced', usage: '.typing on | .typing off',
    summary: { en: 'Toggle automatic typing indicator' }, description: { ar: 'يشغّل أو يوقف إظهار مؤشر الكتابة أثناء معالجة أوامر المجموعة.', en: 'Enables or disables the typing indicator while processing commands in this group.' },
    handler: async ctx => {
      const value = String(ctx.args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) return ctx.reply(error('Usage: .typing on or .typing off'));
      const g = ctx.db.group(ctx.threadID); g.typingEnabled = value === 'on'; await ctx.db.save();
      return ctx.reply(success(`Typing indicator ${value.toUpperCase()}`));
    },
  },
  {
    name: 'off', aliases: [], category: 'advanced', usage: '.off',
    summary: { en: 'Clear transient cache and restart service' }, description: { ar: 'يمسح حالة المهام المؤقتة ويحاول إعادة تشغيل الخدمة. يتطلب إعداد Railway على ALWAYS.', en: 'Clears transient task state and exits so Railway can restart the service. Requires Railway restart policy ALWAYS.' },
    permission: 'Primary developer only',
    handler: async ctx => {
      if (!ctx.isPrimary) return ctx.reply(error('Primary developer only.'));
      await ctx.db.clearVolatileCache();
      await ctx.reply(success('Maintenance restart', 'Transient cache cleared. The service will restart if the host restart policy is enabled.'));
      setTimeout(() => process.exit(1), 1200).unref?.();
    },
  },
];

  },
  "src/commands/auto.js": function (require, module, exports) {
'use strict';

const { success, error, frame } = require('../utils/format');
const { sleep } = require('../utils/time');

module.exports = [
  {
    name: 'spam', aliases: ['sp', 'سبام'], category: 'auto', usage: '.spam <message> <seconds>s [count]',
    summary: { en: 'Repeat a short announcement with limits' }, description: { ar: 'يرسل إعلاناً متكرراً بعد فاصل محدد، بعدد محدود فقط، ويمكن إيقافه.', en: 'Repeats an announcement at a chosen interval with a strict count limit and a stop command.' },
    off: '.unsp',
    handler: async ctx => {
      const tokens = ctx.argsText.split(/\s+/).filter(Boolean);
      if (tokens.length < 2) return ctx.reply(error('Usage: .spam <message> <seconds>s [count]'));
      let count = ctx.config.maxRepeatCount;
      let intervalIndex = tokens.length - 1;
      const lastAsCount = Number(tokens[tokens.length - 1]);
      if (Number.isInteger(lastAsCount) && lastAsCount > 0 && tokens.length >= 3) {
        count = Math.min(ctx.config.maxRepeatCount, lastAsCount);
        intervalIndex = tokens.length - 2;
      }
      const secondsToken = tokens[intervalIndex].match(/^(\d+)s?$/i);
      if (!secondsToken) return ctx.reply(error('Add an interval, for example: .spam Meeting starts soon 30s 3'));
      const seconds = Number(secondsToken[1]);
      const messageTokens = tokens.slice(0, intervalIndex);
      const message = messageTokens.join(' ').trim();
      if (!message) return ctx.reply(error('The repeated message cannot be empty.'));
      if (seconds < ctx.config.minRepeatIntervalSeconds) return ctx.reply(error(`The minimum interval is ${ctx.config.minRepeatIntervalSeconds} seconds.`));
      ctx.jobs.cancel(ctx.threadID, 'repeat');
      let remaining = count;
      const timer = setInterval(async () => {
        try {
          if (remaining <= 0 || ctx.db.get('locked')) { ctx.jobs.cancel(ctx.threadID, 'repeat'); return; }
          remaining -= 1;
          await ctx.reply(message);
          if (remaining <= 0) {
            ctx.jobs.cancel(ctx.threadID, 'repeat');
            await ctx.reply(frame('𝖠𝗎𝗍𝗈 ᚲ', 'Announcement schedule completed.'));
          }
        } catch (err) {
          ctx.jobs.cancel(ctx.threadID, 'repeat');
          ctx.logger.error('Scheduled announcement failed', { error: err.message, threadID: ctx.threadID });
        }
      }, seconds * 1000);
      timer.unref?.();
      ctx.jobs.set(ctx.threadID, 'repeat', timer);
      return ctx.reply(success('Announcement scheduled', `Interval : ${seconds}s\nMaximum repetitions : ${count}\nStop : .unsp`));
    },
  },
  {
    name: 'unsp', aliases: ['spoff', 'spstop', 'سبام ايقاف', 'سبام إيقاف'], category: 'auto', usage: '.unsp',
    summary: { en: 'Stop scheduled announcement' }, description: { ar: 'يوقف التكرار المجدول في المجموعة.', en: 'Cancels the repeating announcement in this group.' },
    handler: async ctx => {
      const stopped = ctx.jobs.cancel(ctx.threadID, 'repeat');
      return ctx.reply(stopped ? success('Announcement stopped') : frame('𝖠𝗎𝗍𝗈', 'No active repeat job in this group.'));
    },
  },
  {
    name: 'rest', aliases: ['res', 'راحة'], category: 'auto', usage: '.rest',
    summary: { en: 'Stop current scheduled jobs' }, description: { ar: 'يوقف جميع المهام المجدولة حالياً.', en: 'Cancels all active scheduled tasks without disconnecting the bot.' },
    handler: async ctx => {
      const count = ctx.jobs.cancelAll();
      return ctx.reply(success('Scheduled tasks stopped', `Cancelled jobs : ${count}`));
    },
  },
];

  },
  "src/commands/core.js": function (require, module, exports) {
'use strict';

const { MAIN_MENU, frame, bilingual, error } = require('../utils/format');
const { normalizeArabic } = require('../utils/parser');
const { apiCall } = require('../systems/fca');

const CATEGORY_NAMES = {
  core: '𝖢𝖮𝖱𝖤 ᚲ 𖣂︎', group: '𝖦𝖱𝖮𝖴𝖯', protection: '𝖯𝖱𝖮𝖳𝖤𝖢𝖳𝖨𝖮𝖭',
  auto: '𝖠𝖴𝖳𝖮', developer: '𝖣𝖤𝖵𝖤𝖫𝖮𝖯𝖤𝖱', media: '𝖬𝖤𝖣𝖨𝖠', advanced: '𝖠𝖣𝖵𝖠𝖭𝖢𝖤𝖣',
};
const CATEGORY_ALIASES = {
  core: 'core', group: 'group', protection: 'protection', protect: 'protection', auto: 'auto',
  developper: 'developer', developer: 'developer', dev: 'developer', media: 'media', advanced: 'advanced', adv: 'advanced',
};

function categoryList(ctx, category) {
  const list = ctx.commands.filter(c => c.category === category && !c.hidden);
  const lines = list.map((c, i) => `${String(i + 1).padStart(2, '0')}. ${c.name}  ┃ ${c.summary.en}`);
  const prompt = 'إختر الأمر الذي تود معرفته ( لعرض قائمة الأوامر يرجى كتابة الأمر .bot أو .menu )\n\n• Choose the command you want to know about (to display the list of commands please type .bot or .menu)';
  return frame(CATEGORY_NAMES[category], `${prompt}\n\n${lines.join('\n')}\n\n𝑑𝑣.  .tp ${category} menu\n𝑑𝑣.  .help <command>\n\n𖤐 Response Timer : 𝟮𝗌`, '𝘉ُٓٓ𝘰𝘵 𝘛𝘢͜͡𝘩𝘢 🕷');
}


function categoryDetails(ctx, category) {
  const items = ctx.commands.filter(c => c.category === category && !c.hidden);
  const parts = items.map(command => [
    `〔 .${command.name} 〕`,
    `Usage : ${command.usage}`,
    `العربية : ${command.description.ar}`,
    `English : ${command.description.en}`,
    `Off : ${command.off || '—'}`,
  ].join('\n'));
  return frame(CATEGORY_NAMES[category], parts.join('\n\n━━━━━━━━━━━━━━━━\n\n'));
}

function commandDetails(command) {
  const aliases = command.aliases?.length ? command.aliases.join(' / ') : command.name;
  return frame(`𝖢𝗈𝗆𝗆𝖺𝗇𝖽 ᚲ ${command.name}`, `𝖴𝗌𝖺𝗀𝖾\n${command.usage}\n\n𝖠𝗅𝗂𝖺𝗌𝖾𝗌\n${aliases}\n\nالعربية\n${command.description.ar}\n\nEnglish\n${command.description.en}\n\n𝖯𝖾𝗋𝗆𝗂𝗌𝗌𝗂𝗈𝗇𝗌\n${command.permission || 'Bot developers'}\n\n𝖢𝖺𝗇𝖼𝖾𝗅 / 𝖮𝖿𝖿\n${command.off || 'Not applicable'}`);
}

const commands = [
  {
    name: 'menu', aliases: ['bot', 'setup', 'طه', 'بوت'], category: 'core', usage: '.menu',
    summary: { en: 'Main menu' }, description: { ar: 'يعرض القائمة الرئيسية الرسمية للبوت.', en: 'Shows the official compact main menu.' },
    permission: 'Primary developer and appointed bot developers',
    handler: async ctx => ctx.reply(MAIN_MENU),
  },
  {
    name: 'tp', aliases: [], category: 'core', usage: '.tp <category> [menu|command]',
    summary: { en: 'Command guide' }, description: { ar: 'يفتح دليل القسم أو يشرح أمراً محدداً داخله.', en: 'Opens a category guide or explains a command within it.' },
    handler: async ctx => {
      const key = normalizeArabic(ctx.args[0] || '');
      const category = CATEGORY_ALIASES[key];
      if (!category) {
        const body = Object.entries(CATEGORY_NAMES).map(([id, label]) => `• ${label}  ┃ .tp ${id}`).join('\n');
        return ctx.reply(frame('𝖢𝖺𝗍𝖾𝗀𝗈𝗋𝗂𝖾𝗌', `اختر القسم / Choose a category\n\n${body}`));
      }
      const sub = normalizeArabic(ctx.args[1] || '');
      if (!sub) return ctx.reply(categoryList(ctx, category));
      if (sub === 'menu' || sub === 'all') {
        return ctx.reply(categoryDetails(ctx, category));
      }
      const found = ctx.commands.find(c => c.category === category && [c.name, ...(c.aliases || [])].some(a => normalizeArabic(a) === sub));
      if (!found) return ctx.reply(error(`Command not found in ${category}. Use .tp ${category} to see available commands.`));
      return ctx.reply(commandDetails(found));
    },
  },
  {
    name: 'help', aliases: ['هيلب', 'مساعدة', 'hlp'], category: 'core', usage: '.help <command>',
    summary: { en: 'Command assistance' }, description: { ar: 'يعرض شرحاً تفصيلياً لأي أمر وطريقة استعماله وإيقافه.', en: 'Explains a command, its usage, permissions and stop command.' },
    handler: async ctx => {
      const query = ctx.args.join(' ').replace(/^[.!•—]+/, '');
      if (!query) return ctx.reply(frame('𝖧𝖾𝗅𝗉 ᚲ', 'What do u need ?\n\nفي ما تريد المساعدة\n\n𝑑𝑣.  .help <command>'));
      const key = normalizeArabic(query);
      const firstKey = normalizeArabic(query.split(/\s+/)[0]);
      const found = ctx.commands.find(c => [c.name, ...(c.aliases || [])].some(a => {
        const alias = normalizeArabic(a);
        return alias === key || alias === firstKey;
      }));
      if (!found) return ctx.reply(error(`Unknown command: ${query}`));
      return ctx.reply(commandDetails(found));
    },
  },
  {
    name: 'tahabot', aliases: ['taha-status'], category: 'core', usage: '.tahabot',
    summary: { en: 'Bot status and statistics' }, description: { ar: 'يعرض اتصال البوت ومدة تشغيله وإحصائيات الأوامر والمطورين.', en: 'Shows connection state, uptime, command statistics and developers.' },
    handler: async ctx => {
      const s = ctx.db.get('stats');
      const uptime = Math.floor(process.uptime());
      const duration = `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
      return ctx.reply(frame('𝖳. 𝖲𝗍𝖺𝗍𝗎𝗌', `𖣂︎ Connection : ${ctx.connected ? 'ONLINE' : 'OFFLINE'}\n𖣂︎ Uptime : ${duration}\n𖣂︎ Commands executed : ${s.executed}\n𖣂︎ Commands failed : ${s.failed}\n𖣂︎ Messages received : ${s.received}\n𖣂︎ Developers : ${ctx.db.get('developers').length}\n𖣂︎ Primary developer : ${ctx.primaryDeveloperId}\n𖣂︎ Mode : ${ctx.db.get('locked') ? 'LOCKED' : 'ACTIVE'}`));
    },
  },
  {
    name: 'onl', aliases: ['اونلاين', 'اون', 'أون', 'online'], category: 'core', usage: '.onl',
    summary: { en: 'Connection diagnostics' }, description: { ar: 'يعرض حالة اتصال الخدمة ووقت الاستجابة التقريبي.', en: 'Shows service connection and approximate event-loop responsiveness.' },
    handler: async ctx => {
      const start = Date.now();
      await apiCall(ctx.api, 'getThreadInfo', ctx.threadID);
      const latency = Date.now() - start;
      return ctx.reply(frame('𝖮𝗇𝗅𝗂𝗇𝖾 ᚲ', `Status : ONLINE\nAPI response : ${latency} ms\nProcess uptime : ${Math.floor(process.uptime())} sec\nMQTT listener : ${ctx.connected ? 'CONNECTED' : 'UNKNOWN'}\nControl : READY`));
    },
  },
  {
    name: 'ping', aliases: ['بينغ'], category: 'core', usage: '.ping',
    summary: { en: 'Ping-pong response test' }, description: { ar: 'يختبر زمن استجابة واجهة Messenger.', en: 'Measures a round-trip API response time.' },
    handler: async ctx => {
      await ctx.reply('🏓');
      const start = Date.now();
      await apiCall(ctx.api, 'getThreadInfo', ctx.threadID);
      const ms = Date.now() - start;
      return ctx.reply(frame('𝖯𝗂𝗇𝗀 ᚲ', `🏓 Pong!\nCurrent response : ${ms} ms\nMaximum observed : ${ctx.maxLatency || ms} ms\nStatus : STABLE`));
    },
  },
  {
    name: 'lock', aliases: ['قفل', 'لوك'], category: 'core', usage: '.lock',
    summary: { en: 'Lock all bot commands' }, description: { ar: 'يقفل البوت بالكامل. المطور الأساسي وحده يستطيع فتحه.', en: 'Locks command handling. Only the primary developer can unlock it.' },
    permission: 'Primary developer only',
    handler: async ctx => {
      if (!ctx.isPrimary) return ctx.reply(error('Primary developer only.'));
      await ctx.db.set('locked', true);
      return ctx.reply(frame('𝖲𝗒𝗌𝗍𝖾𝗆 𝖫𝗈𝖼𝗄', '𖣂︎ TAHA BOT is now locked.\nOnly the primary developer can unlock the system.'));
    },
  },
  {
    name: 'unlock', aliases: ['فك', 'فك القفل', 'اينلوك'], category: 'core', usage: '.unlock',
    summary: { en: 'Unlock bot commands' }, description: { ar: 'يفتح البوت بعد القفل ولا يسمح بذلك إلا للمطور الأساسي.', en: 'Re-enables commands; primary developer only.' },
    permission: 'Primary developer only',
    handler: async ctx => {
      if (!ctx.isPrimary) return ctx.reply(error('Primary developer only.'));
      await ctx.db.set('locked', false);
      await ctx.db.set('maintenance', false);
      return ctx.reply(frame('𝖲𝗒𝗌𝗍𝖾𝗆 𝖴𝗇𝗅𝗈𝖼𝗄', '𖣂︎ TAHA BOT is active again.'));
    },
  },
];

module.exports = commands;

  },
  "src/commands/developer.js": function (require, module, exports) {
'use strict';

const { frame, success, error } = require('../utils/format');
const { getTargetID } = require('../utils/parser');
const { apiCall } = require('../systems/fca');

module.exports = [
  {
    name: 'dv', aliases: ['dev', 'deve', 'مطور'], category: 'developer', usage: '.dv @member (or reply)',
    summary: { en: 'Appoint a bot developer' }, description: { ar: 'يضيف العضو إلى فريق مطوري البوت. المطور الأساسي وحده يملك هذه الصلاحية.', en: 'Adds a member to the bot developer team. Only the primary developer can appoint developers.' },
    permission: 'Primary developer only',
    handler: async ctx => {
      if (!ctx.isPrimary) return ctx.reply(error('Primary developer only.'));
      const target = getTargetID(ctx, ctx.args[0]);
      if (!target) return ctx.reply(error('Reply to a member or mention them.'));
      if (target === ctx.primaryDeveloperId) return ctx.reply(error('That account is already the primary developer.'));
      await ctx.db.addDeveloper(target);
      return ctx.reply(success('Developer appointed', `Developer ID : ${target}`));
    },
  },
  {
    name: 'undv', aliases: ['undev', 'مطور ازالة', 'مطور إزالة', 'ازالة مطور', 'إزالة مطور'], category: 'developer', usage: '.undv @developer (or reply)',
    summary: { en: 'Remove a bot developer' }, description: { ar: 'يزيل المطور المحدد من فريق البوت. المطور الأساسي وحده يستطيع ذلك.', en: 'Removes a selected bot developer. Primary developer only.' },
    permission: 'Primary developer only',
    handler: async ctx => {
      if (!ctx.isPrimary) return ctx.reply(error('Primary developer only.'));
      const target = getTargetID(ctx, ctx.args[0]);
      if (!target) return ctx.reply(error('Reply to a developer or mention them.'));
      if (target === ctx.primaryDeveloperId) return ctx.reply(error('The primary developer cannot be removed.'));
      await ctx.db.removeDeveloper(target);
      return ctx.reply(success('Developer removed', `User ID : ${target}`));
    },
  },
  {
    name: 'own', aliases: [], category: 'developer', usage: '.own',
    summary: { en: 'Show owner and developer details' }, description: { ar: 'يعرض معلومات المطور الأساسي ثم قائمة المطورين المعينين.', en: 'Shows the primary developer identifier and appointed developer list.' },
    handler: async ctx => {
      const ownerInfo = await apiCall(ctx.api, 'getUserInfo', ctx.primaryDeveloperId).catch(() => null);
      const owner = ownerInfo?.[ctx.primaryDeveloperId] || ownerInfo?.[0] || ownerInfo || {};
      await ctx.reply(frame('𝖯𝗋𝗂𝗆𝖺𝗋𝗒 𝖣𝖾𝗏𝖾𝗅𝗈𝗉𝖾𝗋', `Name : ${owner.name || 'Unavailable'}\nID : ${ctx.primaryDeveloperId}\nProfile : ${owner.profileUrl || 'Unavailable'}\nPhoto : ${owner.thumbSrc || 'Unavailable'}`));
      const devs = ctx.db.get('developers');
      return ctx.reply(frame('𝖣𝖾𝗏𝖾𝗅𝗈𝗉𝖾𝗋𝗌', devs.length ? devs.map((id, i) => `${i + 1}. ${id}`).join('\n') : 'No appointed developers.'));
    },
  },
];

  },
  "src/commands/group.js": function (require, module, exports) {
'use strict';

const { frame, success, error } = require('../utils/format');
const { getTargetID } = require('../utils/parser');
const { apiCall } = require('../systems/fca');

function participantCount(info) { return info?.participantIDs?.length ?? info?.participants?.length ?? 0; }
function adminsCount(info) { return info?.adminIDs?.length ?? info?.admins?.length ?? 0; }

module.exports = [
  {
    name: 'gp', aliases: ['group', 'جروب', 'مجموعة'], category: 'group', usage: '.gp',
    summary: { en: 'Group information' }, description: { ar: 'يعرض اسم المجموعة والأعضاء والمسؤولين والمطورين وحالة الحماية والأعضاء المعلقين.', en: 'Displays group title, member/admin counts, bot developers, protection state and pending members when exposed by the adapter.' },
    handler: async ctx => {
      const info = await apiCall(ctx.api, 'getThreadInfo', ctx.threadID);
      const g = ctx.db.group(ctx.threadID);
      const pending = info?.approvalQueue?.length ?? info?.pendingParticipants?.length ?? 'Unavailable';
      return ctx.reply(frame('𝖦𝗋𝗈𝗎𝗉 𝖨𝗇𝖿𝗈', `Name : ${info?.threadName || info?.name || 'Unnamed'}\nMembers : ${participantCount(info)}\nAdministrators : ${adminsCount(info)}\nBot developers : ${ctx.db.get('developers').length}\nName protection : ${g.nameProtection.enabled ? 'ON' : 'OFF'}\nNickname protection : ${g.nickProtection.enabled ? 'ON' : 'OFF'}\nPending members : ${pending}`));
    },
  },
  {
    name: 'add', aliases: ['اضافة', 'إضافة'], category: 'group', usage: '.add <profile URL or @mention>',
    summary: { en: 'Add a member to this group' }, description: { ar: 'يحاول إضافة عضو باستخدام الإشارة أو رابط الملف الشخصي.', en: 'Attempts to add a member using a mention or profile URL.' },
    handler: async ctx => {
      let userID = getTargetID(ctx, ctx.args[0]);
      if (!userID && ctx.args[0]) {
        const raw = ctx.args.join(' ').trim();
        const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?facebook\.com\/([^/?#]+)/i);
        const lookup = urlMatch && !/^profile\.php$/i.test(urlMatch[1]) ? decodeURIComponent(urlMatch[1]) : raw;
        const matches = await apiCall(ctx.api, 'getUserID', lookup);
        userID = String(matches?.find?.(item => item?.userID)?.userID || '');
      }
      if (!userID) return ctx.reply(error('Mention a member or provide a profile URL.'));
      await apiCall(ctx.api, 'addUserToGroup', userID, ctx.threadID);
      return ctx.reply(success('Member added', `ID : ${userID}`));
    },
  },
  {
    name: 'kick', aliases: ['طرد'], category: 'group', usage: '.kick @member (or reply to their message)',
    summary: { en: 'Remove a member from the group' }, description: { ar: 'يطرد العضو المشار إليه أو الذي رددت على رسالته.', en: 'Removes the mentioned or replied-to member from the group.' },
    handler: async ctx => {
      const target = getTargetID(ctx, ctx.args[0]);
      if (!target) return ctx.reply(error('Reply to a member or mention them.'));
      if (target === ctx.primaryDeveloperId) return ctx.reply(error('The primary developer is protected and cannot be targeted.'));
      await apiCall(ctx.api, 'removeUserFromGroup', target, ctx.threadID);
      return ctx.reply(success('Member removed', `User ID : ${target}`));
    },
  },
  {
    name: 'leave', aliases: ['quit', 'lev', 'مغادرة', 'خروج'], category: 'group', usage: '.leave',
    summary: { en: 'Leave this group only' }, description: { ar: 'يجعل حساب البوت يغادر هذه المجموعة فقط ويظل متصلاً في المجموعات الأخرى.', en: 'Makes the bot account leave this group while the service remains active elsewhere.' },
    handler: async ctx => {
      const selfID = ctx.currentUserID || String(await apiCall(ctx.api, 'getCurrentUserID'));
      await ctx.reply(success('Leaving group', 'TAHA BOT remains online in other conversations.'));
      await apiCall(ctx.api, 'removeUserFromGroup', selfID, ctx.threadID);
      await ctx.db.removeThread(ctx.threadID);
    },
  },
  {
    name: 'admin', aliases: ['adm', 'مسؤول', 'ادمن'], category: 'group', usage: '.admin @member (or reply)',
    summary: { en: 'Promote a group administrator' }, description: { ar: 'يرقي العضو إلى مسؤول في المجموعة إذا كان حساب البوت يملك صلاحية الإدارة.', en: 'Promotes a member to group administrator if the bot account has sufficient rights.' },
    handler: async ctx => {
      const target = getTargetID(ctx, ctx.args[0]);
      if (!target) return ctx.reply(error('Reply to a member or mention them.'));
      if (target === ctx.primaryDeveloperId) return ctx.reply(error('The primary developer is protected.'));
      await apiCall(ctx.api, 'changeAdminStatus', ctx.threadID, target, true);
      return ctx.reply(success('Administrator promoted', `User ID : ${target}`));
    },
  },
  {
    name: 'unadmin', aliases: ['unad', 'adminoff', 'ادمن ازالة', 'ادمن إزالة', 'مسؤول ازالة', 'ازالة مسؤول', 'إزالة مسؤول'], category: 'group', usage: '.unadmin @member (or reply)',
    summary: { en: 'Demote a group administrator' }, description: { ar: 'يزيل صفة المسؤول من العضو المحدد.', en: 'Removes administrator status from the selected member.' },
    handler: async ctx => {
      const target = getTargetID(ctx, ctx.args[0]);
      if (!target) return ctx.reply(error('Reply to a member or mention them.'));
      if (target === ctx.primaryDeveloperId) return ctx.reply(error('The primary developer is protected.'));
      await apiCall(ctx.api, 'changeAdminStatus', ctx.threadID, target, false);
      return ctx.reply(success('Administrator demoted', `User ID : ${target}`));
    },
  },
  {
    name: 'uid', aliases: ['id', 'ايدي'], category: 'group', usage: '.uid @member (or reply)',
    summary: { en: 'Get numeric user ID' }, description: { ar: 'يعرض المعرّف الرقمي للعضو فقط.', en: 'Returns the target member numeric ID.' },
    handler: async ctx => {
      const target = getTargetID(ctx, ctx.args[0]);
      if (!target) return ctx.reply(error('Reply to a member or mention them.'));
      let numeric = target;
      try {
        const info = await apiCall(ctx.api, 'getUserInfo', target);
        const user = info?.[target] || info?.[0] || info;
        numeric = String(user?.id || user?.userID || target).replace(/\D/g, '') || target;
      } catch { /* the mention already contains the numeric ID */ }
      return ctx.reply(numeric);
    },
  },
];

  },
  "src/commands/index.js": function (require, module, exports) {
'use strict';

const { normalizeArabic } = require('../utils/parser');

const modules = [
  require('./core'), require('./group'), require('./protection'), require('./auto'),
  require('./developer'), require('./media'), require('./advanced'),
];
const commands = modules.flat();
const byName = new Map();
for (const command of commands) {
  for (const alias of [command.name, ...(command.aliases || [])]) {
    byName.set(normalizeArabic(alias), command);
  }
}
module.exports = { commands, byName };

  },
  "src/commands/media.js": function (require, module, exports) {
  'use strict';

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const { frame, error } = require('../utils/format');
  const { getTargetID } = require('../utils/parser');
  const { apiCall, apiCallTimeout } = require('../systems/fca');
  const { sleep } = require('../utils/time');
  const logger = require('../utils/logger');

  // Messenger accepts attachments up to ~25 MB; stay safely below it.
  const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
  const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
  const MAX_SONG_BYTES = 20 * 1024 * 1024;
  const REQUEST_TIMEOUT_MS = 25000;
  // Uploading a 10-20 MB file can take longer than the default 30s API timeout.
  const SEND_TIMEOUT_MS = 240000;
  const APP_NAME = 'TAHA_BOT';
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const AUDIO_ARCHIVE_API = 'https://archive.org/advancedsearch.php';
  const AUDIUS_API = 'https://api.audius.co/v1';
  const PEERTUBE_SEARCH_API = 'https://sepiasearch.org/api/v1/search/videos';
  let openverseAccessToken = '';
  let openverseTokenExpiresAt = 0;
  const youtubeSongCache = new Map();
  const YOUTUBE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

  function cleanText(value, max = 180) {
    return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFKD').toLowerCase()
      .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function words(value) {
    return [...new Set(normalizeText(value).match(/[\p{L}\p{N}]{2,}/gu) || [])];
  }

  function scoreMatch(query, title, creator = '', description = '') {
    const tokens = words(query);
    if (!tokens.length) return { titleCoverage: 0, creatorCoverage: 0, metadataCoverage: 0, exactPhrase: false, tokenCount: 0 };
    const titleTokens = new Set(words(title));
    const creatorTokens = new Set(words(creator));
    const metaTokens = new Set([...titleTokens, ...creatorTokens, ...words(description)]);
    const hits = (set) => tokens.filter(token => set.has(token)).length;
    const phrase = normalizeText(query);
    const normalizedTitle = normalizeText(title);
    return {
      titleCoverage: hits(titleTokens) / tokens.length,
      creatorCoverage: hits(creatorTokens) / tokens.length,
      metadataCoverage: hits(metaTokens) / tokens.length,
      exactPhrase: Boolean(phrase && normalizedTitle.includes(phrase)),
      tokenCount: tokens.length,
    };
  }

  // Avoid unrelated songs: require a strong title match, or a clear split
  // between title words and artist words when the user supplied both.
  function songMatchOk(match) {
    if (match.tokenCount <= 1) return match.titleCoverage === 1;
    if (match.exactPhrase || match.titleCoverage >= 0.8) return true;
    return match.titleCoverage >= 0.5 && match.creatorCoverage >= 0.3
      && (match.titleCoverage + match.creatorCoverage) >= 0.9;
  }

  async function discard(response) {
    try { await response.body?.cancel(); } catch { /* ignored */ }
  }

  async function getResponse(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (typeof fetch !== 'function') throw new Error('Node.js 18 or newer is required (global fetch is missing).');
    let lastError = new Error('Request failed.');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'follow',
          headers: { 'user-agent': BROWSER_UA, ...(options.headers || {}) },
        });
        if (response.url && new URL(response.url).protocol !== 'https:') {
          await discard(response);
          throw new Error('The media source redirected to an insecure URL.');
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`HTTP ${response.status}`);
          await discard(response);
          await sleep(800);
          continue;
        }
        return response;
      } catch (err) {
        lastError = err;
        if (/insecure/.test(String(err.message))) throw err;
        if (attempt === 0) await sleep(600);
      }
    }
    throw lastError;
  }

  async function getJson(url, options = {}) {
    const response = await getResponse(url, {
      ...options,
      headers: { accept: 'application/json', ...(options.headers || {}) },
    });
    if (!response.ok) { await discard(response); throw new Error(`Search returned HTTP ${response.status}.`); }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') throw new Error('The search returned invalid data.');
    if (data.error || data.error_message) throw new Error(cleanText(data.error_message || data.error, 220));
    return data;
  }

  // Openverse supports anonymous reads; credentials are optional. If a configured
  // token is rejected, getOpenverseJson below retries without authentication.
  async function getOpenverseToken() {
    const clientId = String(process.env.OPENVERSE_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.OPENVERSE_CLIENT_SECRET || '').trim();
    if (!clientId && !clientSecret) return '';
    if (!clientId || !clientSecret) {
      throw new Error('Set both OPENVERSE_CLIENT_ID and OPENVERSE_CLIENT_SECRET.');
    }
    if (openverseAccessToken && Date.now() < openverseTokenExpiresAt - 60000) {
      return openverseAccessToken;
    }

    const response = await getResponse('https://api.openverse.org/v1/auth_tokens/token/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }).toString(),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      throw new Error(`Openverse authentication failed (HTTP ${response.status}).`);
    }
    openverseAccessToken = String(data.access_token);
    openverseTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000;
    return openverseAccessToken;
  }

  async function getOpenverseJson(url) {
    // Prefer authenticated requests when valid credentials are configured.
    // If Openverse rejects a stale/invalid token, retry once anonymously because
    // the public API supports anonymous read requests. This prevents a bad
    // optional token from disabling all Openverse searches.
    let token = '';
    try {
      token = await getOpenverseToken();
    } catch (err) {
      if (!/HTTP 401|HTTP 403|Set both OPENVERSE_CLIENT_ID/i.test(String(err.message))) throw err;
      openverseAccessToken = '';
      openverseTokenExpiresAt = 0;
      logger.warn('Openverse credentials were rejected; retrying anonymously.', {
        error: cleanText(err.message, 140),
      });
      return getJson(url);
    }

    if (!token) return getJson(url);
    try {
      return await getJson(url, { headers: { authorization: `Bearer ${token}` } });
    } catch (err) {
      if (!/Search returned HTTP 401|Search returned HTTP 403/i.test(String(err.message))) throw err;
      openverseAccessToken = '';
      openverseTokenExpiresAt = 0;
      logger.warn('Openverse rejected the access token; retrying anonymously.', {
        error: cleanText(err.message, 140),
      });
      return getJson(url);
    }
  }

  function toHttps(url) {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed;
  }

  async function downloadBuffer(url, maxBytes, timeoutMs = 60000, headers = {}) {
    const parsed = toHttps(url);
    if (parsed.protocol !== 'https:') throw new Error('The provider returned a non-HTTPS media URL.');
    const response = await getResponse(parsed.toString(), { headers }, timeoutMs);
    if (!response.ok || !response.body) { await discard(response); throw new Error(`Media download failed (HTTP ${response.status}).`); }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      await discard(response);
      throw new Error('The provider returned a web page instead of a media file.');
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) { await discard(response); throw new Error('MEDIA_FILE_TOO_LARGE'); }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error('MEDIA_FILE_TOO_LARGE');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignored */ }
    }
    if (!total) throw new Error('The downloaded media file is empty.');
    return Buffer.concat(chunks, total);
  }

  function imageExtension(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'gif';
    return null;
  }

  function imageDimensions(bytes) {
    if (imageExtension(bytes) === 'png' && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (imageExtension(bytes) === 'gif' && bytes.length >= 10) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (imageExtension(bytes) === 'jpg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    if (imageExtension(bytes) === 'webp' && bytes.length >= 30) {
      const kind = bytes.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (kind === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L' && bytes[20] === 0x2f) {
        return {
          width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
          height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6)),
        };
      }
    }
    return null;
  }

  function isMp3(bytes) {
    if (!bytes || bytes.length < 4) return false;
    // Most MP3 files start with an ID3 tag. Some valid files start directly
    // with an MPEG frame, or contain a small leading tag before that frame.
    if (bytes.toString('ascii', 0, 3) === 'ID3') return true;
    const limit = Math.min(bytes.length - 4, 8192);
    for (let offset = 0; offset <= limit; offset += 1) {
      if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue;
      const version = (bytes[offset + 1] >> 3) & 0x03;
      const layer = (bytes[offset + 1] >> 1) & 0x03;
      const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
      const sampleIndex = (bytes[offset + 2] >> 2) & 0x03;
      // Reject reserved MPEG version, reserved layer, free/bad bitrate,
      // and reserved sample-rate headers.
      if (version !== 1 && layer !== 0 && bitrateIndex !== 0 && bitrateIndex !== 15 && sampleIndex !== 3) return true;
    }
    return false;
  }

  function isMp4(bytes) {
    return bytes.length > 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
  }

  // Always use the documented callback form for attachment uploads. Some
  // adapter builds declare sendMessage with default parameters, making
  // Function.length unreliable and causing streams to be destroyed too early.
  function sendAttachmentMessage(api, message, threadID) {
    return new Promise((resolve, reject) => {
      const send = api?.sendMessage;
      if (typeof send !== 'function') {
        reject(new Error('Messenger adapter does not expose sendMessage().'));
        return;
      }

      let settled = false;
      const attachment = message?.attachment;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (attachment && typeof attachment.removeListener === 'function') {
          attachment.removeListener('error', onStreamError);
        }
        if (err) {
          const messageText = err instanceof Error ? err.message : (err?.error || err?.message || String(err));
          reject(new Error(cleanText(messageText, 260)));
        } else {
          resolve(value);
        }
      };
      const onStreamError = err => finish(err);
      const timer = setTimeout(() => {
        finish(new Error(`Messenger attachment upload timed out after ${Math.round(SEND_TIMEOUT_MS / 1000)} seconds.`));
      }, SEND_TIMEOUT_MS);

      if (attachment && typeof attachment.once === 'function') attachment.once('error', onStreamError);
      try {
        const result = send.call(api, message, threadID, (err, info) => finish(err, info));
        if (result && typeof result.then === 'function') {
          result.then(value => finish(null, value), err => finish(err));
        }
      } catch (err) {
        finish(err);
      }
    });
  }

  async function sendFiles(ctx, title, body, files) {
    if (!Array.isArray(files) || !files.length) throw new Error('No media files were prepared for sending.');
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'taha-media-'));
    try {
      const paths = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file?.bytes || (!Buffer.isBuffer(file.bytes) && !(file.bytes instanceof Uint8Array))) {
          throw new Error(`Media item ${i + 1} has no valid file buffer.`);
        }
        const bytes = Buffer.from(file.bytes);
        if (!bytes.length) throw new Error(`Media item ${i + 1} is empty.`);
        const safeName = String(file.name || `media-${i + 1}.${file.extension || 'bin'}`)
          .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90);
        const destination = path.join(tempDir, safeName);
        await fs.promises.writeFile(destination, bytes, { flag: 'wx' });
        paths.push(destination);
      }

      // Send each file as its own attachment. This is more reliable across
      // Messenger adapters than passing an array of ReadStreams in one call.
      for (let i = 0; i < paths.length; i++) {
        const stream = fs.createReadStream(paths[i]);
        const caption = i === 0
          ? frame(title, body)
          : frame(title, `Additional attachment : ${i + 1}/${paths.length}`);
        try {
          await sendAttachmentMessage(ctx.api, { body: caption, attachment: stream }, ctx.threadID);
        } finally {
          stream.destroy();
        }
      }
      return paths.length;
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- photos
  // Openverse indexes openly licensed images. Never scrape arbitrary image
  // search thumbnails and forward them without a verifiable reuse licence.
  async function openverseImageItems(query) {
    const url = new URL('https://api.openverse.org/v1/images/');
    url.searchParams.set('q', query);
    url.searchParams.set('page_size', '40');
    url.searchParams.set('license_type', 'all-cc');
    const data = await getOpenverseJson(url.toString());
    const items = (Array.isArray(data.results) ? data.results : []).filter(item =>
      item?.url && item?.license && item?.license_url && canShareLicense(item.license)
      && item.mature !== true
    );
    if (!items.length) throw new Error('no openly licensed images found');
    return items;
  }

  async function downloadImage(item) {
    try {
      const imageUrl = item.url;
      const origin = new URL(imageUrl).origin;
      const bytes = await downloadBuffer(imageUrl, MAX_PHOTO_BYTES, 25000, {
        referer: `${origin}/`, accept: 'image/*,*/*;q=0.8',
      });
      const extension = imageExtension(bytes);
      if (!extension || bytes.length < 8000) return null;
      const dims = imageDimensions(bytes);
      if (dims && (Math.max(dims.width, dims.height) < 500 || Math.min(dims.width, dims.height) < 250)) return null;
      return {
        bytes, extension,
        title: cleanText(item.title || 'Untitled image', 100),
        creator: cleanText(item.creator || 'Unknown creator', 80),
        source: cleanText(item.foreign_landing_url || item.detail_url || imageUrl, 220),
        license: cleanText(`${item.license}${item.license_version ? ` ${item.license_version}` : ''} — ${item.license_url}`, 220),
      };
    } catch { return null; }
  }

  async function fetchPhotos(query, count) {
    const items = await openverseImageItems(query);
    const ranked = items.map(item => ({ item, match: scoreMatch(query, item.title, item.creator, (item.tags || []).map(tag => tag.name || '').join(' ')) }))
      .filter(({ match }) => match.exactPhrase || match.titleCoverage >= 0.5 || match.metadataCoverage >= 0.65)
      .sort((a, b) =>
        Number(b.match.exactPhrase) - Number(a.match.exactPhrase)
        || b.match.titleCoverage - a.match.titleCoverage
        || b.match.metadataCoverage - a.match.metadataCoverage);
    if (!ranked.length) throw new Error('no close title or tag match with a shareable licence');

    const files = [];
    const seen = new Set();
    for (let i = 0; i < Math.min(ranked.length, 32) && files.length < count; i += 4) {
      const downloaded = await Promise.all(ranked.slice(i, i + 4).map(({ item }) => downloadImage(item)));
      for (const image of downloaded) {
        if (!image || files.length >= count) continue;
        const sig = crypto.createHash('sha1').update(image.bytes).digest('hex');
        if (seen.has(sig)) continue;
        seen.add(sig);
        files.push({ ...image, name: `taha-photo-${files.length + 1}.${image.extension}` });
      }
    }
    if (!files.length) throw new Error('matching openly licensed images were found, but none could be downloaded as a valid image file');
    return files;
  }

  // ---------------------------------------------------------------- licences
  // Only accept explicit public-domain or Creative Commons licences that
  // permit redistribution of an unchanged file. Unknown rights are rejected.
  function canShareLicense(value) {
    const license = String(value || '').trim().toLowerCase();
    if (!license || /all rights reserved|unknown|proprietary|copyright reserved|no redistribution/.test(license)) return false;

    // Public-domain dedication/mark identifiers and URLs.
    if (/public\s*domain|publicdomain|creativecommons\.org\/publicdomain\/(?:zero|mark)|\bcc0\b|(^|[\s/-])pdm($|[\s/-])/.test(license)) return true;

    // A Creative Commons URL must name a specific licence, not just the CC site.
    const urlMatch = license.match(/creativecommons\.org\/licenses\/([^/?#]+)/);
    if (urlMatch) {
      const code = urlMatch[1].toLowerCase().replace(/_/g, '-');
      return /^(by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)$/.test(code);
    }

    // Also recognise explicit short codes returned by Openverse and Jamendo.
    let slug = license
      .replace(/^creative\s+commons\s*/, '')
      .replace(/^cc(?:\s|[-_])*/, '')
      .replace(/\battribution\b/g, 'by')
      .replace(/non[\s-]?commercial/g, 'nc')
      .replace(/no[\s-]?derivatives|no[\s-]?derivs/g, 'nd')
      .replace(/share[\s-]?alike/g, 'sa')
      .replace(/\bversion\b/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-(international|unported|generic|us)$/g, '');

    if (slug === 'cc0' || slug === 'pdm') return true;
    return /^(by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)(?:-\d+(?:-\d+)?)?$/.test(slug);
  }

  function safeSearchPhrase(query) {
    return cleanText(query, 120).replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  async function searchInternetArchive(mediaType, query, rows = 30) {
    const phrase = safeSearchPhrase(query);
    const tokens = words(phrase).filter(word => !['the', 'and', 'for', 'with', 'song', 'music', 'video', 'اغنيه', 'اغنيه', 'موسيقى', 'فيديو'].includes(word)).slice(0, 6);
    const searches = [`mediatype:${mediaType} AND title:"${phrase}"`];
    if (tokens.length) {
      const groups = tokens.map(word => `(title:${word} OR creator:${word} OR subject:${word})`);
      searches.push(`mediatype:${mediaType} AND ${groups.join(' AND ')}`);
      // A looser discovery pass helps find records when a user omits a word
      // or uses a slightly different title. Strict matching below still applies.
      searches.push(`mediatype:${mediaType} AND (${groups.join(' OR ')})`);
    }
    const merged = new Map();
    for (const q of searches) {
      const url = new URL(AUDIO_ARCHIVE_API);
      url.searchParams.set('q', q);
      url.searchParams.set('output', 'json');
      url.searchParams.set('rows', String(rows));
      for (const field of ['identifier', 'title', 'creator', 'description', 'licenseurl', 'rights', 'downloads', 'subject']) {
        url.searchParams.append('fl[]', field);
      }
      url.searchParams.append('sort[]', 'downloads desc');
      const data = await getJson(url.toString());
      for (const doc of data?.response?.docs || []) if (doc?.identifier) merged.set(doc.identifier, doc);
      if (merged.size >= rows) break;
    }
    return [...merged.values()];
  }

  function archiveFileUrl(identifier, fileName) {
    const filePath = String(fileName).split('/').map(encodeURIComponent).join('/');
    return `https://archive.org/download/${encodeURIComponent(identifier)}/${filePath}`;
  }

  async function getArchiveMetadata(identifier) {
    return getJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  }

  function chooseArchiveFile(files, maxBytes) {
    const candidates = (files || []).filter(file => {
      if (!file?.name || file.source === 'metadata' || file.private === 'true') return false;
      const name = String(file.name).toLowerCase();
      const size = Number(file.size || 0);
      return name.endsWith('.mp3') && size > 0 && size <= maxBytes;
    });
    return candidates.sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0] || null;
  }

  // ----------------------------------------------------------------- songs
  async function fetchOpenverseSong(query) {
    const parts = String(query || '').split(/\s+[-–—|]\s+/).map(part => cleanText(part, 160)).filter(Boolean);
    const searches = [{ field: 'q', value: cleanText(query, 180) }];
    if (parts.length === 2) {
      // When the user writes Artist - Title, search the title and creator
      // fields separately as well as the complete phrase.
      searches.push({ field: 'title', value: parts[1] });
      searches.push({ field: 'creator', value: parts[0] });
    }

    const uniqueSearches = [...new Map(searches.map(item => [`${item.field}:${normalizeText(item.value)}`, item])).values()];
    const merged = new Map();
    let firstSearchError = null;

    for (const search of uniqueSearches) {
      const url = new URL('https://api.openverse.org/v1/audio/');
      url.searchParams.set(search.field, search.value);
      url.searchParams.set('page_size', '30');
      url.searchParams.set('license', 'pdm,cc0,by,by-sa,by-nd,by-nc,by-nc-sa,by-nc-nd');
      url.searchParams.set('extension', 'mp3');
      url.searchParams.set('category', 'music');
      url.searchParams.set('filter_dead', 'true');
      try {
        const data = await getOpenverseJson(url.toString());
        for (const track of Array.isArray(data?.results) ? data.results : []) {
          const id = String(track?.id || track?.url || '');
          if (id && !merged.has(id)) merged.set(id, track);
        }
      } catch (err) {
        firstSearchError ||= err;
        logger.warn('Openverse search variant failed', {
          field: search.field,
          query: cleanText(search.value, 100),
          error: cleanText(err.message, 140),
        });
      }
    }

    if (!merged.size && firstSearchError) throw firstSearchError;
    const tracks = [...merged.values()];
    const ranked = tracks.map(track => ({
      track,
      match: scoreMatch(query, track.title, track.creator,
        [track.description || '', ...(track.tags || []).map(tag => tag.name || '')].join(' ')),
    })).filter(({ track, match }) => track?.url && track?.license && track?.license_url
      && track.mature !== true
      && canShareLicense(track.license)
      && songMatchOk(match))
      .sort((a, b) => Number(b.match.exactPhrase) - Number(a.match.exactPhrase)
        || b.match.titleCoverage - a.match.titleCoverage
        || b.match.creatorCoverage - a.match.creatorCoverage
        || b.match.metadataCoverage - a.match.metadataCoverage);

    if (!ranked.length) throw new Error(tracks.length
      ? 'Openverse returned audio, but none passed title matching and explicit licence checks.'
      : 'Openverse returned no MP3 results for this query.');

    // Try multiple valid files; reject HTML/error pages and malformed audio.
    for (const { track } of ranked.slice(0, 12)) {
      try {
        const bytes = await downloadBuffer(track.url, MAX_SONG_BYTES, 90000);
        if (!isMp3(bytes)) continue;
        const id = String(track.id || 'audio').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
        return {
          bytes,
          extension: 'mp3',
          name: `taha-openverse-${id || 'audio'}.mp3`,
          title: cleanText(track.title || 'Unknown title', 110),
          creator: cleanText(track.creator || 'Unknown artist', 90),
          source: cleanText(track.foreign_landing_url || track.detail_url || 'https://openverse.org', 220),
          license: cleanText(`${track.license}${track.license_version ? ` ${track.license_version}` : ''} — ${track.license_url}`, 220),
        };
      } catch (err) {
        logger.warn('Openverse MP3 download failed; trying another result', {
          trackID: String(track.id || 'unknown'), error: cleanText(err.message, 140),
        });
      }
    }
    throw new Error('Openverse found licensed audio, but none could be downloaded as a valid MP3.');
  }

  async function fetchJamendoSong(query) {
    const clientId = String(process.env.JAMENDO_CLIENT_ID || '').trim();
    if (!clientId) throw new Error('JAMENDO_CLIENT_ID is not configured.');

    const url = new URL('https://api.jamendo.com/v3.0/tracks/');
    url.search = new URLSearchParams({
      client_id: clientId,
      format: 'json',
      search: cleanText(query, 180),
      limit: '25',
      order: 'relevance',
      include: 'licenses',
      audiodlformat: 'mp31',
    }).toString();

    const data = await getJson(url.toString());
    const tracks = Array.isArray(data?.results) ? data.results : [];
    const ranked = tracks.map(track => ({
      track,
      match: scoreMatch(query, track.name, track.artist_name, track.album_name || ''),
    })).filter(({ track, match }) => track.audiodownload_allowed === true
      && track.audiodownload && canShareLicense(track.license_ccurl) && songMatchOk(match))
      .sort((a, b) => Number(b.match.exactPhrase) - Number(a.match.exactPhrase)
        || b.match.titleCoverage - a.match.titleCoverage
        || b.match.creatorCoverage - a.match.creatorCoverage);

    for (const { track } of ranked.slice(0, 8)) {
      try {
        const bytes = await downloadBuffer(track.audiodownload, MAX_SONG_BYTES, 90000);
        if (!isMp3(bytes)) continue;
        return {
          bytes,
          extension: 'mp3',
          name: `taha-jamendo-${String(track.id).replace(/[^a-zA-Z0-9_-]/g, '')}.mp3`,
          title: cleanText(track.name || 'Unknown title', 110),
          creator: cleanText(track.artist_name || 'Unknown artist', 90),
          source: cleanText(track.shareurl || `https://www.jamendo.com/track/${track.id}`, 220),
          license: cleanText(track.license_ccurl, 180),
        };
      } catch { /* try the next permitted Jamendo result */ }
    }
    throw new Error('Jamendo had no close MP3 match with artist-enabled downloading and a shareable Creative Commons licence.');
  }

  function audiusTrackLicenseAllowed(track) {
    const raw = cleanText(track?.license || track?.license_type || '', 180).toLowerCase();
    // Missing rights metadata is not permission to redistribute.
    if (!raw || /all rights reserved|\barr\b|proprietary|copyright reserved|no redistribution/.test(raw)) return false;

    // Audius may label Creative Commons tracks as "Attribution CC BY",
    // "Attribution CC BY-SA", etc. Preserve support for those explicit forms.
    const compact = raw.replace(/[^a-z0-9]/g, '');
    if (/^attributionccby(?:sa|nd|nc(?:sa|nd)?)?$/.test(compact)) return true;
    if (/^cc(?:0|by(?:sa|nd|nc(?:sa|nd)?)?)$/.test(compact)) return true;

    // Only a named, explicit licence is accepted; unknown labels are rejected.
    return canShareLicense(raw);
  }

  // Audius has a public read-only API. Tracks are only considered when the
  // creator has enabled downloads; an explicit All Rights Reserved label is
  // rejected. Tracks with no alternative licence use Audius' Open Music
  // License for API music-player integrations. The API's official download
  // endpoint is used; no YouTube/Spotify extraction is performed.
  async function fetchAudiusSong(query) {
    const searchUrl = new URL(`${AUDIUS_API}/tracks/search`);
    searchUrl.searchParams.set('query', cleanText(query, 180));
    searchUrl.searchParams.set('limit', '25');
    searchUrl.searchParams.set('app_name', APP_NAME);
    const apiKey = String(process.env.AUDIUS_API_KEY || '').trim();
    const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    const data = await getJson(searchUrl.toString(), { headers });
    const tracks = Array.isArray(data?.data) ? data.data : [];
    const ranked = tracks.map(track => {
      const creator = track?.user?.name || track?.user?.handle || track?.artist_name || '';
      const match = scoreMatch(query, track?.title || track?.name, creator, track?.description || track?.tags || '');
      return { track, creator, match };
    }).filter(({ track, match }) =>
      (track?.is_downloadable === true || track?.downloadable === true)
      && track?.is_download_gated !== true
      && track?.is_available !== false
      && audiusTrackLicenseAllowed(track)
      && songMatchOk(match)
      && track?.id
    ).sort((a, b) =>
      Number(b.match.exactPhrase) - Number(a.match.exactPhrase)
      || b.match.titleCoverage - a.match.titleCoverage
      || b.match.creatorCoverage - a.match.creatorCoverage
      || Number(b.track.play_count || b.track.playCount || 0) - Number(a.track.play_count || a.track.playCount || 0)
    );

    if (!ranked.length) throw new Error('no close Audius match with creator-enabled downloads and an allowed API licence');

    for (const { track, creator } of ranked.slice(0, 10)) {
      try {
        const downloadUrl = new URL(`${AUDIUS_API}/tracks/${encodeURIComponent(track.id)}/download`);
        downloadUrl.searchParams.set('app_name', APP_NAME);
        const bytes = await downloadBuffer(downloadUrl.toString(), MAX_SONG_BYTES, 120000, headers);
        if (!isMp3(bytes)) continue;
        const label = cleanText(track.license || 'Audius Open Music License', 100);
        return {
          bytes,
          extension: 'mp3',
          name: `taha-audius-${String(track.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}.mp3`,
          title: cleanText(track.title || 'Unknown title', 110),
          creator: cleanText(creator || 'Unknown artist', 90),
          source: cleanText(track.permalink || track.url || `https://audius.co`, 220),
          license: `${label} — creator-enabled download`,
        };
      } catch (err) {
        logger.warn('Audius track download failed; trying next match', {
          trackID: String(track.id), error: cleanText(err.message, 140),
        });
      }
    }
    throw new Error('Audius found tracks, but none returned a valid downloadable MP3 within the Messenger file limit');
  }

  async function fetchArchiveSong(query) {
    const docs = await searchInternetArchive('audio', query, 35);
    if (!docs.length) throw new Error('no results');
    const ranked = docs.map(doc => ({ doc, match: scoreMatch(query, doc.title, doc.creator, '') }))
      .filter(({ match }) => songMatchOk(match))
      .sort((a, b) =>
        (Number(b.match.exactPhrase) - Number(a.match.exactPhrase)) ||
        (b.match.metadataCoverage - a.match.metadataCoverage) ||
        (Number(b.doc.downloads || 0) - Number(a.doc.downloads || 0)));
    if (!ranked.length) throw new Error('no close title/artist match');
    for (const { doc } of ranked.slice(0, 8)) {
      try {
        const archive = await getJson(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
        const metadata = archive?.metadata || {};
        const license = metadata.licenseurl || doc.licenseurl || metadata.rights || doc.rights || '';
        if (!canShareLicense(license)) continue;
        const file = chooseArchiveFile(archive?.files, MAX_SONG_BYTES);
        if (!file) continue;
        const bytes = await downloadBuffer(archiveFileUrl(doc.identifier, file.name), MAX_SONG_BYTES, 90000);
        if (!isMp3(bytes)) continue;
        return {
          bytes, extension: 'mp3',
          name: `taha-song-${String(doc.identifier).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}.mp3`,
          title: cleanText(metadata.title || doc.title || 'Unknown title', 110),
          creator: cleanText(metadata.creator || doc.creator || 'Unknown artist', 90),
          source: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
          license: cleanText(license, 180),
        };
      } catch { /* next result */ }
    }
    throw new Error('no shareable MP3 among the matches');
  }

  // ---------------------------------------------------------------- ccMixter
  // ccMixter publishes a public Query API intended for third-party applications.
  // Search is restricted to the CC BY licence (lic=by) so unchanged MP3 files
  // can be redistributed with attribution. The official public download route
  // is used; no stream ripping or third-party extractor is involved.
  function xmlDecode(value) {
    return String(value || '')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  }

  function ccMixterHostUrl(value) {
    try {
      const url = new URL(String(value || ''), 'https://ccmixter.org');
      if (url.protocol !== 'https:' || !/(^|\.)ccmixter\.org$/i.test(url.hostname)) return '';
      return url.toString();
    } catch { return ''; }
  }

  function ccMixterText(node, keys) {
    for (const key of keys) {
      const value = node?.[key];
      if (typeof value === 'string' || typeof value === 'number') {
        const text = cleanText(value, 220);
        if (text) return text;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const nested of ['name', 'username', 'fullname', 'title', 'value']) {
          const text = cleanText(value[nested], 120);
          if (text) return text;
        }
      }
    }
    return '';
  }

  function collectCcMixterRows(payload) {
    const rows = [];
    const seen = new Set();
    const urlPattern = /(?:https:\/\/[^\s"'<>]+|\/(?:download|content|files)\/[^\s"'<>]+)/gi;
    const mediaPath = /\.(?:mp3|ogg|wav|flac)(?:[?#]|$)|\/download\//i;

    function addRow(row) {
      const title = ccMixterText(row, ['upload_name', 'name', 'title', 'track_title', 'filename']);
      const creator = ccMixterText(row, ['user_name', 'upload_user', 'user', 'artist_name', 'artist', 'creator', 'author']);
      const uploadId = ccMixterText(row, ['upload_id', 'id']);
      const license = ccMixterText(row, ['upload_license', 'license', 'lic']);
      const urls = [];
      for (const [key, value] of Object.entries(row || {})) {
        if (typeof value !== 'string' || !/(url|link|file|download|enclosure|html|content)/i.test(key)) continue;
        const decoded = xmlDecode(value);
        const matches = decoded.match(urlPattern) || [];
        for (const match of matches) {
          const url = ccMixterHostUrl(match.replace(/[),.;]+$/, ''));
          if (url && mediaPath.test(url)) urls.push(url);
        }
        const direct = ccMixterHostUrl(decoded);
        if (direct && mediaPath.test(direct)) urls.push(direct);
      }
      const fallback = uploadId && creator
        ? `https://ccmixter.org/download/${encodeURIComponent(creator)}/${encodeURIComponent(uploadId)}`
        : '';
      const key = `${normalizeText(title)}|${normalizeText(creator)}|${uploadId}`;
      if (!title || seen.has(key)) return;
      seen.add(key);
      rows.push({ title, creator, license, urls: [...new Set([...urls, fallback].filter(Boolean))] });
    }

    function walk(node, depth = 0) {
      if (depth > 7 || node == null) return;
      if (Array.isArray(node)) {
        for (const item of node.slice(0, 100)) walk(item, depth + 1);
        return;
      }
      if (typeof node === 'string') {
        // Some ccHost views wrap HTML in a JSON field. Extract only links hosted
        // by ccMixter and pointing at an audio download route/file.
        const links = [];
        const re = /(?:href|url)\s*=\s*["']([^"']+)["']/gi;
        let match;
        while ((match = re.exec(node))) {
          const url = ccMixterHostUrl(xmlDecode(match[1]));
          if (url && mediaPath.test(url)) links.push(url);
        }
        if (links.length) rows.push({ title: '', creator: '', license: 'by', urls: [...new Set(links)] });
        return;
      }
      if (typeof node !== 'object') return;
      addRow(node);
      for (const value of Object.values(node)) {
        if (value && (typeof value === 'object' || typeof value === 'string')) walk(value, depth + 1);
      }
    }

    walk(payload);
    return rows.filter(row => row.urls.length);
  }

  function parseCcMixterRss(xml) {
    const rows = [];
    const blocks = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
    const extract = (block, tag) => {
      const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return match ? xmlDecode(match[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')) : '';
    };
    for (const block of blocks.slice(0, 30)) {
      const title = extract(block, 'title');
      const creator = extract(block, '(?:dc:creator|author)');
      const urls = [];
      const enclosureRe = /<(?:enclosure|media:content)\b[^>]*\burl=["']([^"']+)["'][^>]*>/gi;
      let match;
      while ((match = enclosureRe.exec(block))) {
        const url = ccMixterHostUrl(xmlDecode(match[1]));
        if (url) urls.push(url);
      }
      const link = extract(block, 'link');
      const linkUrl = ccMixterHostUrl(link);
      if (linkUrl && /\.(?:mp3|ogg|wav|flac)(?:[?#]|$)|\/download\//i.test(linkUrl)) urls.push(linkUrl);
      if (title && urls.length) rows.push({ title, creator, license: 'by', urls: [...new Set(urls)] });
    }
    return rows;
  }

  async function fetchCcMixterRows(query, searchType = 'all') {
    const url = new URL('https://ccmixter.org/api/query');
    url.search = new URLSearchParams({
      datasource: 'uploads',
      search: cleanText(query, 160),
      search_type: searchType,
      lic: 'by',
      f: 'json',
      dataview: 'links_by_dl',
      limit: '30',
    }).toString();
    try {
      const data = await getJson(url.toString());
      const rows = collectCcMixterRows(data);
      if (rows.length) return rows;
    } catch (err) {
      logger.warn('ccMixter JSON query failed; trying its RSS output.', { query, error: cleanText(err.message, 140) });
    }

    const rssUrl = new URL('https://ccmixter.org/api/query');
    rssUrl.search = new URLSearchParams({
      datasource: 'uploads', search: cleanText(query, 160), search_type: searchType,
      lic: 'by', f: 'rss', limit: '30',
    }).toString();
    const response = await getResponse(rssUrl.toString(), {
      headers: { accept: 'application/rss+xml, application/xml, text/xml' },
    }, 35000);
    if (!response.ok) { await discard(response); throw new Error(`ccMixter returned HTTP ${response.status}`); }
    const xml = await response.text();
    return parseCcMixterRss(xml);
  }

  async function fetchCcMixterSong(query) {
    const types = ['all', 'any'];
    let lastReason = 'no CC BY matches';
    for (const searchType of types) {
      let rows = [];
      try {
        rows = await fetchCcMixterRows(query, searchType);
      } catch (err) {
        lastReason = cleanText(err.message, 120) || lastReason;
        continue;
      }
      const ranked = rows.map(row => ({
        row,
        match: scoreMatch(query, row.title, row.creator, ''),
      })).filter(({ row, match }) => row.urls.length && songMatchOk(match)
        && (!row.license || /^(?:by|cc\s*by|attribution)$/i.test(row.license.trim())))
        .sort((a, b) => Number(b.match.exactPhrase) - Number(a.match.exactPhrase)
          || b.match.titleCoverage - a.match.titleCoverage
          || b.match.creatorCoverage - a.match.creatorCoverage);

      for (const { row } of ranked.slice(0, 10)) {
        for (const url of row.urls) {
          try {
            const bytes = await downloadBuffer(url, MAX_SONG_BYTES, 90000);
            if (!isMp3(bytes)) continue;
            return {
              bytes, extension: 'mp3',
              name: `taha-ccmixter-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 14)}.mp3`,
              title: cleanText(row.title, 110),
              creator: cleanText(row.creator || 'ccMixter contributor', 90),
              source: cleanText(url, 220),
              license: 'Creative Commons Attribution (CC BY) — ccMixter search filtered to lic=by',
              attribution: `${cleanText(row.title, 110)} by ${cleanText(row.creator || 'ccMixter contributor', 90)} (CC BY, ccMixter)`,
            };
          } catch (err) {
            lastReason = cleanText(err.message, 120);
          }
        }
      }
    }
    throw new Error(`no matching downloadable MP3 under CC BY (${lastReason})`);
  }

  function cleanYouTubeSongTitle(value) {
    return cleanText(String(value || '')
      .replace(/[\[(](?:official(?: music)? video|official audio|lyrics?(?: video)?|visuali[sz]er|4k|hd|remaster(?:ed)?)[^\])]*[\])]/gi, ' ')
      .replace(/\s*[-|–]\s*(?:official(?: music)? video|official audio|lyrics?(?: video)?|visuali[sz]er).*$/i, ' ')
      .replace(/\s+/g, ' '), 130);
  }

  // YouTube is used only to identify likely title/artist metadata. This code
  // never downloads, extracts, or converts audio from YouTube videos.
  async function searchYouTubeSong(query) {
    const apiKey = String(process.env.YOUTUBE_API_KEY || '').trim();
    if (!apiKey) return { best: null, candidates: [] };

    const cacheKey = normalizeText(query);
    const cached = youtubeSongCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < YOUTUBE_CACHE_TTL_MS) return cached.value;

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('order', 'relevance');
    url.searchParams.set('maxResults', '8');
    url.searchParams.set('safeSearch', 'none');
    url.searchParams.set('q', cleanText(query, 180));
    url.searchParams.set('key', apiKey);

    const data = await getJson(url.toString());
    const ranked = (Array.isArray(data?.items) ? data.items : [])
      .filter(item => item?.id?.videoId && item?.snippet?.title)
      .map(item => {
        const snippet = item.snippet;
        const title = cleanYouTubeSongTitle(snippet.title);
        const creator = cleanText(snippet.channelTitle || '', 100);
        const match = scoreMatch(query, title || snippet.title, creator, snippet.description || '');
        return { item, title: title || cleanText(snippet.title, 130), creator, match };
      })
      .filter(result => result.match.exactPhrase || result.match.titleCoverage >= 0.5 || result.match.metadataCoverage >= 0.75)
      .sort((a, b) => Number(b.match.exactPhrase) - Number(a.match.exactPhrase)
        || b.match.titleCoverage - a.match.titleCoverage
        || b.match.metadataCoverage - a.match.metadataCoverage);

    const best = ranked[0] ? {
      title: ranked[0].title,
      creator: ranked[0].creator,
      videoId: String(ranked[0].item.id.videoId),
    } : null;
    const candidates = [];
    for (const result of ranked.slice(0, 4)) {
      if (result.title && normalizeText(result.title) !== cacheKey) candidates.push(result.title);
      const combined = cleanText(`${result.creator} ${result.title}`, 180);
      if (result.creator && result.title && normalizeText(combined) !== cacheKey) candidates.push(combined);
    }
    const value = { best, candidates: [...new Set(candidates)].slice(0, 6) };
    youtubeSongCache.set(cacheKey, { savedAt: Date.now(), value });
    if (youtubeSongCache.size > 200) {
      const oldestKey = youtubeSongCache.keys().next().value;
      if (oldestKey) youtubeSongCache.delete(oldestKey);
    }
    return value;
  }

  async function runProviders(kind, query, providers) {
    const errors = [];
    for (const [name, run] of providers) {
      try { return await run(query); }
      catch (err) {
        const message = cleanText(err.message, 110);
        errors.push(`${name}: ${message}`);
        logger.warn(`${kind} provider failed`, { provider: name, query, error: message });
      }
    }
    throw new Error(`${errors.join(' | ')}`);
  }

  function expandSongQueries(query, youtubeCandidates = []) {
    const expanded = [];
    const add = value => {
      const cleaned = cleanText(value, 180);
      if (cleaned && !expanded.some(existing => normalizeText(existing) === normalizeText(cleaned))) expanded.push(cleaned);
    };
    for (const value of [query, ...youtubeCandidates]) {
      add(value);
      const parts = String(value || '').split(/\s+[-–—|]\s+/).map(part => cleanText(part, 140)).filter(Boolean);
      if (parts.length === 2) {
        add(parts[1]); // title-only query
        add(parts[0]); // artist-only query
        add(`${parts[1]} ${parts[0]}`);
      }
    }
    return expanded.slice(0, 5);
  }

  async function fetchSong(query) {
    let youtube = { best: null, candidates: [] };
    try {
      youtube = await searchYouTubeSong(query);
      if (!process.env.YOUTUBE_API_KEY) {
        logger.info('YOUTUBE_API_KEY is not set; using the original song query and public audio catalogues.');
      }
    } catch (err) {
      logger.warn('YouTube metadata lookup failed; continuing with the original query', {
        query, error: cleanText(err.message, 160),
      });
    }

    const queries = expandSongQueries(query, youtube.candidates || []);
    const providers = [
      ['Openverse', fetchOpenverseSong],
      ['Audius', fetchAudiusSong],
      ['ccMixter', fetchCcMixterSong],
      ['Internet Archive', fetchArchiveSong],
    ];
    if (String(process.env.JAMENDO_CLIENT_ID || '').trim()) providers.push(['Jamendo', fetchJamendoSong]);

    const providerFailures = new Map();
    for (const searchQuery of queries) {
      for (const [name, run] of providers) {
        try {
          const song = await run(searchQuery);
          song.provider = name;
          if (youtube.best) {
            song.youtubeMatch = youtube.best.title + (youtube.best.creator ? ' — ' + youtube.best.creator : '');
          }
          return song;
        } catch (err) {
          const reason = cleanText(err.message || err, 150);
          // Keep one concise failure per provider; later query variants can
          // replace a generic "no results" with a more useful download error.
          if (!providerFailures.has(name) || /HTTP|download|licen[cs]e|timeout|network/i.test(reason)) {
            providerFailures.set(name, reason);
          }
          logger.warn('Song provider failed; trying the next catalogue', {
            provider: name,
            query: cleanText(searchQuery, 140),
            error: reason,
          });
        }
      }
    }

    const detail = providers.map(([name]) => `${name}: ${providerFailures.get(name) || 'no usable result'}`).join(' | ');
    const jamendoNote = String(process.env.JAMENDO_CLIENT_ID || '').trim()
      ? '' : ' | Jamendo: not configured (optional)';
    throw new Error(`NO_MATCHING_LICENSED_MP3: ${detail}${jamendoNote}`);
  }

  // ---------------------------------------------------------------- videos
  async function fetchPexelsVideo(query) {
    const key = process.env.PEXELS_API_KEY;
    if (!key) throw new Error('PEXELS_API_KEY not set');
    const data = await getJson(`https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(query)}&per_page=15`, { headers: { authorization: key } });
    const videos = Array.isArray(data?.videos) ? data.videos : [];
    if (!videos.length) throw new Error('no videos found');
    for (const video of videos) {
      const files = (video.video_files || []).filter(f => f?.link && /mp4/i.test(f.file_type || '') && Number(f.width || 0) <= 1280)
        .sort((a, b) => Number(b.width || 0) - Number(a.width || 0));
      for (const file of files) {
        try {
          const bytes = await downloadBuffer(file.link, MAX_VIDEO_BYTES, 90000);
          if (!isMp4(bytes)) continue;
          return {
            bytes, extension: 'mp4', name: `taha-pexels-${video.id}.mp4`,
            title: cleanText(`${query} (stock video)`, 110),
            creator: cleanText(video.user?.name || 'Pexels contributor', 90),
            source: cleanText(video.url || 'https://www.pexels.com', 200),
            license: 'Pexels License (free to use)',
          };
        } catch { /* try a smaller rendition */ }
      }
    }
    throw new Error('no video small enough to send');
  }

  async function fetchPixabayVideo(query) {
    const key = process.env.PIXABAY_API_KEY;
    if (!key) throw new Error('PIXABAY_API_KEY not set');
    const url = new URL('https://pixabay.com/api/videos/');
    url.searchParams.set('key', key);
    url.searchParams.set('q', cleanText(query, 100));
    url.searchParams.set('per_page', '15');
    url.searchParams.set('safesearch', 'true');
    const data = await getJson(url.toString());
    const hits = Array.isArray(data?.hits) ? data.hits : [];
    if (!hits.length) throw new Error('no videos found');
    for (const hit of hits) {
      for (const size of ['medium', 'large', 'small', 'tiny']) {
        const rendition = hit.videos?.[size];
        if (!rendition?.url || (Number(rendition.size) && Number(rendition.size) > MAX_VIDEO_BYTES)) continue;
        try {
          const bytes = await downloadBuffer(rendition.url, MAX_VIDEO_BYTES, 90000);
          if (!isMp4(bytes)) continue;
          return {
            bytes, extension: 'mp4', name: `taha-pixabay-${hit.id}.mp4`,
            title: cleanText(hit.tags || `${query} (stock video)`, 110),
            creator: cleanText(hit.user || 'Pixabay contributor', 90),
            source: cleanText(hit.pageURL || 'https://pixabay.com', 200),
            license: 'Pixabay Content License (free to use)',
          };
        } catch { /* try another rendition */ }
      }
    }
    throw new Error('no video small enough to send');
  }

  // PeerTube downloadEnabled is not itself a redistribution licence.
  function peertubeLicenseAllowed(value) {
    return canShareLicense(value);
  }

  async function fetchPeerTubeVideo(query) {
    const searchUrl = new URL(PEERTUBE_SEARCH_API);
    searchUrl.searchParams.set('search', query);
    searchUrl.searchParams.set('count', '40');
    searchUrl.searchParams.set('nsfw', 'false');
    searchUrl.searchParams.set('durationMax', '900');
    const search = await getJson(searchUrl.toString());
    const results = Array.isArray(search?.data) ? search.data : [];
    if (!results.length) throw new Error('no videos found');

    const scored = results.map(item => {
      const creator = item.account?.displayName || item.account?.name || item.channel?.displayName || item.channel?.name || '';
      return { item, creator, match: scoreMatch(query, item.name || item.title, creator, item.description || '') };
    });
    const sorter = (a, b) =>
      (Number(b.match.exactPhrase) - Number(a.match.exactPhrase)) ||
      (b.match.titleCoverage - a.match.titleCoverage) ||
      (b.match.metadataCoverage - a.match.metadataCoverage) ||
      (Number(b.item.views || 0) - Number(a.item.views || 0));
    const ranked = scored.filter(({ match }) => match.tokenCount <= 1
      ? match.titleCoverage === 1
      : (match.exactPhrase || match.titleCoverage >= 0.8)).sort(sorter);
    if (!ranked.length) throw new Error('no close title match');

    for (const { item, creator } of ranked.slice(0, 10)) {
      try {
        const watchUrl = item.url ? new URL(item.url) : null;
        if (!watchUrl || watchUrl.protocol !== 'https:') continue;
        const videoId = item.uuid || item.shortUUID || watchUrl.pathname.match(/\/(?:videos\/watch|w)\/([^/?#]+)/)?.[1];
        if (!videoId) continue;
        const detail = await getJson(`${watchUrl.origin}/api/v1/videos/${encodeURIComponent(videoId)}`);
        if (detail.downloadEnabled !== true || detail.privacy?.id !== 1 || detail.nsfw === true || detail.blacklisted === true) continue;
        const license = detail.licence?.label || item.licence?.label || '';
        if (!peertubeLicenseAllowed(license)) continue;
        // Newer PeerTube versions often keep files only inside HLS playlists.
        const allFiles = [...(detail.files || []), ...(detail.streamingPlaylists || []).flatMap(p => p.files || [])];
        const rank = file => { const r = Number(file.resolution?.id || file.height || 0); return r <= 720 ? r : -r; };
        const files = allFiles.filter(file => file?.fileDownloadUrl || file?.fileUrl)
          .filter(file => file.hasVideo !== false)
          .filter(file => !Number(file.size) || Number(file.size) <= MAX_VIDEO_BYTES)
          .sort((a, b) => rank(b) - rank(a));
        for (const file of files.slice(0, 3)) {
          try {
            const bytes = await downloadBuffer(new URL(file.fileDownloadUrl || file.fileUrl, watchUrl.origin).toString(), MAX_VIDEO_BYTES, 120000);
            if (!isMp4(bytes)) continue;
            return {
              bytes, extension: 'mp4',
              name: `taha-video-${String(videoId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}.mp4`,
              title: cleanText(detail.name || item.name || 'Unknown video', 110),
              creator: cleanText(detail.account?.displayName || detail.account?.name || creator || 'Unknown creator', 90),
              source: `https://${watchUrl.host}${watchUrl.pathname}`,
              license: cleanText(license || 'Download enabled by the uploader', 120),
            };
          } catch { /* next file */ }
        }
      } catch { /* one unavailable instance/file should not stop the next hit */ }
    }
    throw new Error('no downloadable MP4 among the matches');
  }

  function fetchVideo(query) {
    return runProviders('video', query, [
      ['PeerTube', fetchPeerTubeVideo], ['Internet Archive', fetchArchiveVideo],
    ]);
  }

  async function fetchArchiveVideo(query) {
    const docs = await searchInternetArchive('movies', query, 35);
    const ranked = docs.map(doc => ({ doc, match: scoreMatch(query, doc.title, doc.creator, doc.description || '') }))
      .filter(({ match }) => match.exactPhrase || match.titleCoverage >= 0.8
        || (match.titleCoverage >= 0.5 && match.metadataCoverage >= 0.8))
      .sort((a, b) => Number(b.match.exactPhrase) - Number(a.match.exactPhrase)
        || b.match.titleCoverage - a.match.titleCoverage
        || Number(b.doc.downloads || 0) - Number(a.doc.downloads || 0));
    if (!ranked.length) throw new Error('no close video title match');

    for (const { doc } of ranked.slice(0, 10)) {
      try {
        const archive = await getArchiveMetadata(doc.identifier);
        const metadata = archive?.metadata || {};
        const license = metadata.licenseurl || doc.licenseurl || metadata.rights || doc.rights || '';
        if (!canShareLicense(license)) continue;
        const candidates = (archive?.files || []).filter(file => {
          const name = String(file?.name || '').toLowerCase();
          const size = Number(file?.size || 0);
          return name.endsWith('.mp4') && file.source !== 'metadata'
            && file.private !== 'true' && size > 0 && size <= MAX_VIDEO_BYTES;
        }).sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
        for (const file of candidates.slice(0, 3)) {
          try {
            const bytes = await downloadBuffer(archiveFileUrl(doc.identifier, file.name), MAX_VIDEO_BYTES, 120000);
            if (!isMp4(bytes)) continue;
            return {
              bytes, extension: 'mp4',
              name: `taha-archive-${String(doc.identifier).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}.mp4`,
              title: cleanText(metadata.title || doc.title || 'Unknown video', 110),
              creator: cleanText(metadata.creator || doc.creator || 'Unknown creator', 90),
              source: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
              license: cleanText(license, 180),
            };
          } catch { /* try another file */ }
        }
      } catch { /* try another archive result */ }
    }
    throw new Error('no openly licensed downloadable MP4 among the close matches');
  }

  // -------------------------------------------------------------- commands
  module.exports = [
    {
      name: 'yt', aliases: ['يوت', 'video', 'فيديو'], category: 'media', usage: '.yt <video search>',
      summary: { en: 'Find and send a matching downloadable video' },
      description: { ar: 'يبحث في PeerTube وInternet Archive عن فيديو MP4 مطابق يمكن تنزيله وإعادة مشاركته بترخيص واضح.', en: 'Searches PeerTube and Internet Archive for closely matching MP4 videos with explicit redistribution permission.' },
      handler: async ctx => {
        const query = ctx.argsText.trim();
        if (!query) return ctx.reply(error('اكتب وصف الفيديو بعد الأمر .yt'));
        await ctx.reply(frame('𝖵𝗂𝖽𝖾𝗈 ᚲ', `Searching videos for : ${cleanText(query)}\nThis can take up to a minute...`));
        try {
          const video = await fetchVideo(query);
          await sendFiles(ctx, '𝖵𝗂𝖽𝖾𝗈 ᚲ', `Title : ${video.title}\nCreator : ${video.creator}\nSource : ${video.source}\nLicense : ${video.license}`, [video]);
        } catch (err) {
          logger.warn('Video command failed', { query, error: err.message });
          return ctx.reply(error(`Video delivery failed : ${cleanText(err.message, 300)}`));
        }
      },
    },
    {
      name: 'photo', aliases: ['pin', 'صورة', 'بين'], category: 'media', usage: '.photo <search words> [1-5]',
      summary: { en: 'Search the web and send matching photos' },
      description: { ar: 'يبحث في Openverse عن صور ذات ترخيص Creative Commons أو ملكية عامة، ويتحقق من كل ملف ثم يرسله كمرفق مستقل مع ذكر صاحبه وترخيصه.', en: 'Searches Openverse for openly licensed images, validates each file and sends each as a separate attachment with attribution.' },
      handler: async ctx => {
        const raw = ctx.argsText.trim();
        if (!raw) return ctx.reply(error('اكتب وصف الصور بعد الأمر .photo'));
        const match = raw.match(/\s+(\d+)\s*$/);
        const count = match ? Number(match[1]) : 4;
        if (!Number.isInteger(count) || count < 1 || count > 5) return ctx.reply(error('عدد الصور يجب أن يكون من 1 إلى 5. مثال: .photo anime 5'));
        const query = match ? raw.slice(0, match.index).trim() : raw;
        if (!query) return ctx.reply(error('اكتب كلمات البحث أولاً.'));
        await ctx.reply(frame('𝖯𝗁𝗈𝗍𝗈𝗌 ᚲ', `Image search : ${cleanText(query)}\nRequested : ${count} photo(s)\nFiltering matching full-size images...`));
        try {
          const files = await fetchPhotos(query, count);
          const credits = files.map((file, index) => `${index + 1}. ${file.title}\nCreator : ${file.creator}\nSource : ${file.source}\nLicense : ${file.license}`).join('\n\n');
          await sendFiles(ctx, '𝖯𝗁𝗈𝗍𝗈𝗌 ᚲ', `Search : ${cleanText(query)}\nSent : ${files.length} photo(s) as individual attachments\n\n${credits}`, files);
        } catch (err) {
          logger.warn('Photo command failed', { query, error: err.message });
          return ctx.reply(error(`Photo delivery failed : ${cleanText(err.message, 300)}`));
        }
      },
    },
    {
      name: 'song', aliases: ['sg', 'موسيقى', 'سونغ'], category: 'media', usage: '.song <artist - title>',
      summary: { en: 'Find a matching downloadable MP3' },
      description: { ar: 'يبحث في Openverse وAudius وccMixter وInternet Archive، ويضيف Jamendo عند ضبط مفتاحه. يرسل MP3 فقط مع ترخيص واضح وإمكانية تنزيل الملف.', en: 'Searches Openverse, Audius, ccMixter and Internet Archive, with optional Jamendo API search; sends only verified MP3 files with an explicit shareable licence.' },
      handler: async ctx => {
        const query = ctx.argsText.trim();
        if (!query) return ctx.reply(error('اكتب اسم الأغنية أو الفنان بعد الأمر .song'));
        await ctx.reply(frame('𝖬𝗎𝗌𝗂𝖼 ᚲ', `Searching Openverse, Audius, ccMixter and Internet Archive for : ${cleanText(query)}\nPreparing an available MP3 file...`));
        try {
          const song = await fetchSong(query);
          const youtubeLine = song.youtubeMatch ? `\nYouTube match : ${song.youtubeMatch}` : '';
          await sendFiles(ctx, '𝖬𝗎𝗌𝗂𝖼 ᚲ', `Title : ${song.title}\nArtist : ${song.creator}${youtubeLine}\nSource : ${song.source}\nLicense : ${song.license}`, [song]);
        } catch (err) {
          logger.warn('Song command failed', { query, error: err.message });
          const detail = cleanText(String(err.message || '').replace(/^NO_MATCHING_LICENSED_MP3:\s*/i, ''), 250);
          const message = detail
            ? `لم أجد ملف MP3 صالحاً ومسموحاً بإعادة إرساله. تفاصيل البحث: ${detail}`
            : 'لم أجد ملف MP3 مطابقاً يمكن تنزيله وإعادة إرساله من المصادر المتاحة.';
          return ctx.reply(error(message));
        }
      },
    },
    {
      name: 'mediahealth', aliases: ['mhealth', 'فحص الوسائط'], category: 'media', usage: '.mediahealth',
      summary: { en: 'Check media sources and Messenger attachment support' },
      description: { ar: 'يعرض مصادر البحث المتاحة وحالة متغيرات API وطريقة إرسال المرفقات.', en: 'Shows configured media providers and whether the Messenger attachment method is available.' },
      handler: async ctx => {
        const jamendo = Boolean(String(process.env.JAMENDO_CLIENT_ID || '').trim());
        const youtube = Boolean(String(process.env.YOUTUBE_API_KEY || '').trim());
        const openverseAuth = Boolean(String(process.env.OPENVERSE_CLIENT_ID || '').trim() && String(process.env.OPENVERSE_CLIENT_SECRET || '').trim());
        const lines = [
          `Messenger sendMessage : ${typeof ctx.api?.sendMessage === 'function' ? 'AVAILABLE' : 'MISSING'}`,
          'Photos : Openverse (authenticated search with anonymous fallback)',
          `Songs : Openverse + Audius + ccMixter + Internet Archive${jamendo ? ' + Jamendo' : ''}`,
          'Openverse audio : public query/title/creator search; MP3 and licence are checked.',
          'YouTube : metadata lookup only; YouTube API does not provide downloadable MP3 files.',
          'Audius : public read-only search; no key required for basic use.',
          'ccMixter : public API/RSS search, CC BY downloads with attribution; no key required.',
          'Videos : PeerTube + Internet Archive',
          `YouTube metadata key : ${youtube ? 'SET' : 'NOT SET (optional)'}`,
          `Openverse credentials : ${openverseAuth ? 'SET (photos)' : 'NOT SET (photos use anonymous mode)'}`,
          `Jamendo client ID : ${jamendo ? 'SET' : 'MISSING — optional; add JAMENDO_CLIENT_ID for Jamendo search'}`,
          'Note : Audius requires creator-enabled downloads and an explicit accepted licence; ccMixter is filtered to CC BY with attribution.',
          'Attachment test : use .mediatest',
        ];
        return ctx.reply(frame('𝖬𝖾𝖽𝗂𝖺 𝖣𝗂𝖺𝗀𝗇𝗈𝗌𝗍𝗂𝖼', lines.join('\n')));
      },
    },
    {
      name: 'mediatest', aliases: ['mtest', 'اختبار الوسائط'], category: 'media', usage: '.mediatest',
      summary: { en: 'Test sending a real image attachment to Messenger' },
      description: { ar: 'يرسل صورة PNG صغيرة فعلية لاختبار رفع المرفقات إلى ماسنجر دون الاعتماد على أي مصدر خارجي.', en: 'Sends a tiny real PNG file to test Messenger attachment uploads without using an external media provider.' },
      handler: async ctx => {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGOMWvCfgRTARJLqUQ2jGoaUBgA6YwIZJXw7UgAAAABJRU5ErkJggg==', 'base64');
        try {
          await sendFiles(ctx, '𝖬𝖾𝗱𝗂𝖺 𝖳𝖾𝗌𝗍', 'Messenger attachment upload test.\nIf you can see this image, file attachments are working.', [{ bytes: png, name: 'taha-media-test.png', extension: 'png' }]);
          return ctx.reply('✅ Media attachment test succeeded.');
        } catch (err) {
          logger.warn('Media attachment test failed', { error: err.message });
          return ctx.reply(error(`Media attachment test failed : ${cleanText(err.message, 220)}`));
        }
      },
    },
    {
      name: 'pfp', aliases: ['pf'], category: 'media', usage: '.pfp @member (or reply)',
      summary: { en: 'Get a member profile picture link' }, description: { ar: 'يجلب رابط صورة الملف الشخصي للعضو المحدد إذا وفرته المنصة.', en: 'Fetches the selected member profile photo URL when available.' },
      handler: async ctx => {
        const target = getTargetID(ctx, ctx.args[0]); if (!target) return ctx.reply(error('Reply to a member or mention them.'));
        const data = await apiCall(ctx.api, 'getUserInfo', target);
        const user = data?.[target] || data?.[0] || data;
        const url = user?.profilePicUrl || user?.thumbSrc || user?.profileUrl;
        if (!url) return ctx.reply(error('Profile photo URL is unavailable from Messenger.'));
        return ctx.reply(frame('𝖯𝗋𝗈𝖿𝗂𝗅𝖾 𝖯𝗁𝗈𝗍𝗈', `Member ID : ${target}\n${url}`));
      },
    },
  ];
  },

  "src/commands/protection.js": function (require, module, exports) {
'use strict';

const { frame, success, error } = require('../utils/format');
const { getTargetID } = require('../utils/parser');
const { apiCall } = require('../systems/fca');
const { sleep } = require('../utils/time');

function nickMapFromInfo(info) {
  const source = info?.nicknames || info?.participantNicknames || {};
  if (source instanceof Map) return Object.fromEntries(source.entries());
  return source && typeof source === 'object' ? source : {};
}


module.exports = [
  {
    name: 'name', aliases: ['nam', 'نيم', 'اسم', 'إسم'], category: 'protection', usage: '.name',
    summary: { en: 'Protect the group name' }, description: { ar: 'يحفظ اسم المجموعة الحالي ويعيده عند تغييره إذا نجح فحص الحماية.', en: 'Stores the current group title and periodically restores it when changed, where supported.' },
    off: '.nameoff',
    handler: async ctx => {
      const info = await apiCall(ctx.api, 'getThreadInfo', ctx.threadID);
      const title = info?.threadName || info?.name;
      if (!title) return ctx.reply(error('Could not read this group title.'));
      const g = ctx.db.group(ctx.threadID);
      g.nameProtection = { enabled: true, protectedName: title };
      await ctx.db.save();
      return ctx.reply(success('Name protection enabled', `Protected name : ${title}`));
    },
  },
  {
    name: 'nameoff', aliases: ['namoff', 'unname', 'uname', 'اسم ايقاف', 'اسم إيقاف', 'إسم ايقاف', 'إسم إيقاف'], category: 'protection', usage: '.nameoff',
    summary: { en: 'Disable group name protection' }, description: { ar: 'يوقف حماية اسم المجموعة.', en: 'Disables automatic group-title restoration.' },
    handler: async ctx => {
      const g = ctx.db.group(ctx.threadID); g.nameProtection.enabled = false; await ctx.db.save();
      return ctx.reply(success('Name protection disabled'));
    },
  },
  {
    name: 'nicks', aliases: ['nicknames', 'كنيات'], category: 'protection', usage: '.nicks | .nicks change <nickname>',
    summary: { en: 'Protect all member nicknames' }, description: { ar: 'يحفظ الكنيات الحالية ويحاول استعادتها. أضف change ثم الكنية لتعيينها بالتتابع بفاصل ثانيتين.', en: 'Snapshots all current nicknames. Use “change <text>” to set the same nickname sequentially with a two-second gap.' },
    off: '.nicksoff',
    handler: async ctx => {
      const g = ctx.db.group(ctx.threadID);
      const info = await apiCall(ctx.api, 'getThreadInfo', ctx.threadID);
      const members = (info?.participantIDs || []).map(String);
      const phrase = ctx.args[0] && ['change', 'ch', 'تغيير'].includes(ctx.args[0].toLowerCase()) ? ctx.args.slice(1).join(' ').trim() : '';
      const old = nickMapFromInfo(info);
      const protectedMembers = {};
      for (const id of members) {
        // Empty nicknames are also protected: a later nickname change should be reset.
        protectedMembers[id] = phrase || old[id] || '';
      }
      g.nickProtection = { enabled: true, mode: phrase ? 'uniform' : 'snapshot', members: protectedMembers };
      await ctx.db.save();
      if (phrase) {
        let changed = 0;
        let completed = false;
        const controller = new AbortController();
        ctx.jobs.set(ctx.threadID, 'nicks-change', { cancel: () => controller.abort() });
        for (const id of members) {
          if (controller.signal.aborted) break;
          if (id === ctx.currentUserID || id === ctx.primaryDeveloperId) continue;
          await apiCall(ctx.api, 'changeNickname', phrase, ctx.threadID, id);
          changed += 1;
          await sleep(2000);
        }
        completed = !controller.signal.aborted;
        ctx.jobs.cancel(ctx.threadID, 'nicks-change');
        const stopped = !completed;
        return ctx.reply(success(stopped ? 'Nickname update paused' : 'Nickname protection enabled', `Updated ${changed} members.\nNickname : ${phrase}\nRestoration monitor : ACTIVE`));
      }
      return ctx.reply(success('Nickname protection enabled', `Saved ${Object.keys(protectedMembers).length} member nickname states.`));
    },
  },
  {
    name: 'nicksoff', aliases: ['unicks', 'unickes', 'nicksstop', 'كنيات ايقاف', 'كنيات إيقاف', 'ايقاف كنيات', 'إيقاف كنيات'], category: 'protection', usage: '.nicksoff',
    summary: { en: 'Disable all nickname protection' }, description: { ar: 'يوقف حماية كل الكنيات التي حفظها البوت أو غيّرها.', en: 'Disables every nickname protection rule saved by the bot.' },
    handler: async ctx => {
      const g = ctx.db.group(ctx.threadID); g.nickProtection = { enabled: false, mode: 'snapshot', members: {} }; await ctx.db.save();
      return ctx.reply(success('All nickname protection disabled'));
    },
  },
  {
    name: 'nick', aliases: ['كنية'], category: 'protection', usage: '.nick @member [new nickname] (or reply)',
    summary: { en: 'Protect one member nickname' }, description: { ar: 'يحمي كنية عضو واحد، ويمكن إضافة نص لتغيير كنيته ثم حمايتها.', en: 'Protects one selected member nickname; optional text sets the nickname first.' },
    off: '.unick @member',
    handler: async ctx => {
      const target = getTargetID(ctx, ctx.args[0]);
      if (!target) return ctx.reply(error('Reply to a member or mention them.'));
      if (target === ctx.primaryDeveloperId && !ctx.isPrimary) return ctx.reply(error('The primary developer is protected.'));
      const replyNick = ctx.args.join(' ').replace(/^@\S+\s*/, '').trim();
      let nickname = replyNick;
      if (nickname) await apiCall(ctx.api, 'changeNickname', nickname, ctx.threadID, target);
      else {
        const info = await apiCall(ctx.api, 'getThreadInfo', ctx.threadID);
        nickname = nickMapFromInfo(info)[target] || '';
      }
      if (!nickname) return ctx.reply(error('Could not read the nickname. Supply a nickname after the command.'));
      const g = ctx.db.group(ctx.threadID); g.nickProtection.enabled = true; g.nickProtection.members[target] = nickname; await ctx.db.save();
      return ctx.reply(success('Member nickname protected', `Nickname : ${nickname}\nMember ID : ${target}`));
    },
  },
  {
    name: 'unick', aliases: ['nickoff', 'كنية ايقاف', 'كنية إيقاف'], category: 'protection', usage: '.unick @member (or reply)',
    summary: { en: 'Disable one nickname rule' }, description: { ar: 'يزيل حماية كنية العضو المحدد.', en: 'Removes the saved nickname protection for one member.' },
    handler: async ctx => {
      const target = getTargetID(ctx, ctx.args[0]); if (!target) return ctx.reply(error('Reply to a member or mention them.'));
      const g = ctx.db.group(ctx.threadID); delete g.nickProtection.members[target];
      if (!Object.keys(g.nickProtection.members).length) g.nickProtection.enabled = false;
      await ctx.db.save(); return ctx.reply(success('Nickname protection removed', `Member ID : ${target}`));
    },
  },
  {
    name: 'des', aliases: ['تدمير'], category: 'protection', usage: '.des @member (or reply)',
    summary: { en: 'Remove and block rejoining member' }, description: { ar: 'يضيف العضو إلى قائمة منع العودة ويحاول طرده من المجموعة.', en: 'Adds the selected member to the group block list and attempts removal.' },
    off: '.undes @member',
    handler: async ctx => {
      const target = getTargetID(ctx, ctx.args[0]); if (!target) return ctx.reply(error('Reply to a member or mention them.'));
      if (target === ctx.primaryDeveloperId) return ctx.reply(error('The primary developer cannot be targeted.'));
      const g = ctx.db.group(ctx.threadID);
      if (!g.blockedMembers.includes(target)) g.blockedMembers.push(target);
      await ctx.db.save();
      await apiCall(ctx.api, 'removeUserFromGroup', target, ctx.threadID);
      return ctx.reply(success('Member blocked from rejoining', `Member ID : ${target}\nThe bot will check for re-entry while this group is active.`));
    },
  },
  {
    name: 'undes', aliases: ['und', 'تدمير ايقاف', 'تدمير إيقاف'], category: 'protection', usage: '.undes @member (or reply)',
    summary: { en: 'Remove member from rejoin block list' }, description: { ar: 'يلغي منع العضو من العودة.', en: 'Removes the selected member from the automatic rejoin block list.' },
    handler: async ctx => {
      const target = getTargetID(ctx, ctx.args[0]); if (!target) return ctx.reply(error('Reply to a member or mention them.'));
      const g = ctx.db.group(ctx.threadID); g.blockedMembers = g.blockedMembers.filter(id => id !== target); await ctx.db.save();
      return ctx.reply(success('Rejoin block removed', `Member ID : ${target}`));
    },
  },
  {
    name: 'hell', aliases: ['torture', 'هيل', 'تعذيب', 'عذاب'], category: 'auto', usage: '.hell',
    summary: { en: 'Enable reversible group event theme' }, description: { ar: 'يشغّل وضعاً احتفالياً محايداً وقابلاً للإلغاء. لا يغيّر كنيات الجميع إلى إهانات ولا يرسل سباماً.', en: 'Enables a reversible neutral group event theme. It does not mass-rename members with insults or flood the chat.' },
    off: '.helloff',
    handler: async ctx => {
      const g = ctx.db.group(ctx.threadID); if (g.hellMode) return ctx.reply(error('Theme mode is already active.'));
      const info = await apiCall(ctx.api, 'getThreadInfo', ctx.threadID);
      const originalName = info?.threadName || info?.name || '';
      g.hellMode = true;
      g.previousHellName = originalName;
      g.previousNameProtection = { ...g.nameProtection };
      g.nameProtection = { enabled: true, protectedName: 'TAHA • Event Mode' };
      await ctx.db.save();
      await apiCall(ctx.api, 'setTitle', 'TAHA • Event Mode', ctx.threadID);
      return ctx.reply(success('Event theme enabled', 'Group title changed to TAHA • Event Mode. Use .helloff to restore the previous title.'));
    },
  },
  {
    name: 'helloff', aliases: ['hellstop', 'unhell', 'unhill', 'ستوب', 'تعذيب ايقاف', 'تعذيب إيقاف'], category: 'auto', usage: '.helloff',
    summary: { en: 'Disable event theme' }, description: { ar: 'يوقف الوضع الاحتفالي ويعيد اسم المجموعة السابق إن أمكن.', en: 'Disables event mode and restores the previous group title when available.' },
    handler: async ctx => {
      const g = ctx.db.group(ctx.threadID); g.hellMode = false;
      if (g.previousHellName) await apiCall(ctx.api, 'setTitle', g.previousHellName, ctx.threadID);
      g.nameProtection = g.previousNameProtection || { enabled: false, protectedName: '' };
      delete g.previousNameProtection; delete g.previousHellName; await ctx.db.save();
      return ctx.reply(success('Event theme disabled'));
    },
  },
];

  },
  "src/config.js": function (require, module, exports) {
'use strict';

require('dotenv').config();

function parsePrefixes(value) {
  const parts = String(value || '.|•|—|!').split('|').map(x => x.trim()).filter(Boolean);
  return [...new Set(parts)];
}

const config = {
  primaryDeveloperId: String(process.env.PRIMARY_DEVELOPER_ID || '').trim(),
  appStateJson: String(process.env.FB_APPSTATE_JSON || '').trim(),
  appStateFile: process.env.APPSTATE_FILE || 'data/appstate.json',
  appStateSaveIntervalMinutes: Math.max(1, Math.min(60, Number(process.env.APPSTATE_SAVE_INTERVAL_MINUTES) || 5)),
  prefixes: parsePrefixes(process.env.BOT_PREFIXES),
  timezone: process.env.BOT_TIMEZONE || 'Africa/Tunis',
  logLevel: process.env.LOG_LEVEL || 'info',
  protectionScanSeconds: Math.max(15, Number(process.env.PROTECTION_SCAN_SECONDS || 30)),
  maxRepeatCount: Math.min(10, Math.max(1, Number(process.env.MAX_REPEAT_COUNT || 5))),
  minRepeatIntervalSeconds: Math.max(10, Number(process.env.MIN_REPEAT_INTERVAL_SECONDS || 30)),
};

function validateConfig() {
  if (!config.primaryDeveloperId) {
    throw new Error('PRIMARY_DEVELOPER_ID is missing. Set it to your numeric Facebook account ID in Railway Variables.');
  }
  if (!/^\d+$/.test(config.primaryDeveloperId)) {
    throw new Error('PRIMARY_DEVELOPER_ID must contain digits only.');
  }
  if (!config.appStateJson && !require('node:fs').existsSync(config.appStateFile)) {
    throw new Error(`Facebook AppState is missing. Set FB_APPSTATE_JSON or place it at ${config.appStateFile}.`);
  }
}

module.exports = { config, validateConfig };

  },
  "src/systems/database.js": function (require, module, exports) {
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATE = {
  version: 1,
  locked: false,
  maintenance: false,
  developers: [],
  deniedUsers: [],
  activeThreads: [],
  groups: {},
  stats: { received: 0, executed: 0, failed: 0, startedAt: Date.now() },
};

class Database {
  constructor(file = 'data/store.json') {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.state = this.#load();
    this.writeChain = Promise.resolve();
  }

  #load() {
    try {
      if (!fs.existsSync(this.file)) return structuredClone(DEFAULT_STATE);
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...structuredClone(DEFAULT_STATE), ...parsed,
        stats: { ...DEFAULT_STATE.stats, ...(parsed.stats || {}) },
        groups: parsed.groups || {},
      };
    } catch (error) {
      console.error('[database] Could not read store; starting with defaults:', error.message);
      return structuredClone(DEFAULT_STATE);
    }
  }

  get(key) { return this.state[key]; }
  set(key, value) { this.state[key] = value; return this.save(); }
  group(threadID) {
    const id = String(threadID);
    if (!this.state.groups[id]) {
      this.state.groups[id] = {
        nameProtection: { enabled: false, protectedName: '' },
        nickProtection: { enabled: false, mode: 'snapshot', members: {} },
        blockedMembers: [],
        spam: { active: false },
        typingEnabled: true,
        hellMode: false,
      };
    }
    return this.state.groups[id];
  }
  touchThread(threadID) {
    const id = String(threadID);
    if (!this.state.activeThreads.includes(id)) this.state.activeThreads.push(id);
    this.group(id);
    return this.save();
  }
  removeThread(threadID) {
    const id = String(threadID);
    this.state.activeThreads = this.state.activeThreads.filter(item => item !== id);
    return this.save();
  }
  isDeveloper(userID, primaryID) {
    const id = String(userID);
    return id === String(primaryID) || this.state.developers.includes(id);
  }
  isPrimary(userID, primaryID) { return String(userID) === String(primaryID); }
  addDeveloper(userID) {
    const id = String(userID);
    if (!this.state.developers.includes(id)) this.state.developers.push(id);
    return this.save();
  }
  removeDeveloper(userID) {
    this.state.developers = this.state.developers.filter(id => id !== String(userID));
    return this.save();
  }
  wasDenied(userID) { return this.state.deniedUsers.includes(String(userID)); }
  markDenied(userID) {
    const id = String(userID);
    if (!this.state.deniedUsers.includes(id)) this.state.deniedUsers.push(id);
    return this.save();
  }
  increment(name) {
    if (!(name in this.state.stats)) this.state.stats[name] = 0;
    this.state.stats[name] += 1;
    return this.save();
  }
  async save() {
    const data = JSON.stringify(this.state, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      const temp = `${this.file}.tmp`;
      await fs.promises.writeFile(temp, data, { mode: 0o600 });
      await fs.promises.rename(temp, this.file);
    });
    return this.writeChain;
  }
  async clearVolatileCache() {
    // Keep authority, protection settings and counters. Clear only transient job state.
    for (const group of Object.values(this.state.groups)) group.spam = { active: false };
    return this.save();
  }
}

module.exports = { Database };

  },
  "src/systems/dispatcher.js": function (require, module, exports) {
'use strict';

const { parseCommand, normalizeArabic } = require('../utils/parser');
const { error } = require('../utils/format');
const logger = require('../utils/logger');
const { apiCall } = require('./fca');

function resolveCommand(parsed, registry) {
  const candidates = [parsed.name];
  const words = parsed.argsText.split(/\s+/).filter(Boolean);
  for (let i = 1; i <= Math.min(3, words.length); i++) candidates.push(`${parsed.name} ${words.slice(0, i).join(' ')}`);
  for (const candidate of candidates.sort((a, b) => b.length - a.length)) {
    const found = registry.byName.get(normalizeArabic(candidate));
    if (found) {
      const consumedWords = candidate === parsed.name ? 0 : candidate.slice(parsed.name.length).trim().split(/\s+/).length;
      const remaining = words.slice(consumedWords);
      return { command: found, args: remaining, argsText: remaining.join(' ') };
    }
  }
  return null;
}

function makeContext({ event, api, db, config, jobs, registry, currentUserID, connected, ctxState }) {
  const parsed = parseCommand(event.body || event.text || '', config.prefixes);
  if (!parsed) return null;
  const resolved = resolveCommand(parsed, registry);
  if (!resolved) return null;
  const senderID = String(event.senderID || event.author || '');
  const threadID = String(event.threadID || '');
  const isPrimary = senderID === config.primaryDeveloperId;
  return {
    event, api, db, config, jobs, commands: registry.commands,
    command: resolved.command, args: resolved.args, argsText: resolved.argsText,
    senderID, threadID, currentUserID, connected,
    primaryDeveloperId: config.primaryDeveloperId,
    isPrimary,
    isDeveloper: db.isDeveloper(senderID, config.primaryDeveloperId),
    maxLatency: ctxState.maxLatency,
    logger,
    reply: async text => apiCall(api, 'sendMessage', String(text), threadID),
  };
}

async function handleIncoming({ event, api, db, config, jobs, registry, currentUserID, connected, ctxState }) {
  if (!event || !event.threadID || !event.senderID) return;
  if (String(event.senderID) === String(currentUserID)) return;
  const parsed = parseCommand(event.body || event.text || '', config.prefixes);
  if (!parsed) return;
  await db.increment('received');
  await db.touchThread(event.threadID);
  const ctx = makeContext({ event, api, db, config, jobs, registry, currentUserID, connected, ctxState });
  if (!ctx) return;

  const command = ctx.command;
  const isUnlock = command.name === 'unlock';
  if (db.get('locked') && !(isUnlock && ctx.isPrimary)) return;
  if (db.get('maintenance') && !(isUnlock && ctx.isPrimary)) return;

  if (!ctx.isDeveloper) {
    if (!db.wasDenied(ctx.senderID)) {
      await db.markDenied(ctx.senderID);
      await ctx.reply(error('Access denied. This command is reserved for TAHA BOT developers.'));
    }
    return;
  }
  if (command.permission === 'Primary developer only' && !ctx.isPrimary) {
    await ctx.reply(error('Primary developer only.'));
    return;
  }

  const start = Date.now();
  const group = db.group(ctx.threadID);
  let stopTyping = null;
  try {
    if (group.typingEnabled && typeof api.sendTypingIndicator === 'function') {
      const indicator = await apiCall(api, 'sendTypingIndicator', ctx.threadID);
      if (typeof indicator === 'function') stopTyping = indicator;
    }
    await command.handler(ctx);
    await db.increment('executed');
  } catch (err) {
    await db.increment('failed');
    logger.error('Command failed', { command: command.name, threadID: ctx.threadID, senderID: ctx.senderID, error: err.message });
    try { await ctx.reply(error(`Could not complete .${command.name}: ${err.message}`)); } catch { /* connection might be down */ }
  } finally {
    const latency = Date.now() - start;
    ctxState.maxLatency = Math.max(ctxState.maxLatency || 0, latency);
    if (typeof stopTyping === 'function') {
      try { await Promise.resolve(stopTyping()); } catch { /* best effort */ }
    }
  }
}

module.exports = { handleIncoming, resolveCommand };

  },
  "src/systems/fca.js": function (require, module, exports) {
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const logger = require('../utils/logger');

function parseAppState(raw, source) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`${source} is not valid JSON.`); }
  if (!Array.isArray(parsed) || !parsed.length || parsed.some(cookie => !cookie || typeof cookie !== 'object')) {
    throw new Error(`${source} must be a non-empty JSON array of cookie objects.`);
  }
  return parsed;
}

function seedFingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function atomicWrite(file, contents, mode = 0o600) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(temp, contents, { encoding: 'utf8', mode, flag: 'wx' });
    await fs.promises.rename(temp, file);
    try { await fs.promises.chmod(file, mode); } catch { /* best effort on hosted filesystems */ }
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
  }
}

async function readAppState(config) {
  const file = path.resolve(config.appStateFile);
  const seedFile = `${file}.seed-sha256`;
  const envSeed = String(config.appStateJson || '').trim();

  if (fs.existsSync(file)) {
    // A changed Railway variable is treated as an intentional session replacement.
    // An unchanged variable never overwrites the newer snapshot saved on the volume.
    if (envSeed) {
      const currentFingerprint = seedFingerprint(envSeed);
      let previousFingerprint = '';
      try { previousFingerprint = (await fs.promises.readFile(seedFile, 'utf8')).trim(); } catch { /* first run of this feature */ }
      if (previousFingerprint !== currentFingerprint) {
        const replacement = parseAppState(envSeed, 'FB_APPSTATE_JSON');
        await atomicWrite(file, JSON.stringify(replacement));
        await atomicWrite(seedFile, currentFingerprint);
        logger.info('A new FB_APPSTATE_JSON value was detected and stored as the active session seed.');
        return replacement;
      }
    }
    const stored = parseAppState(await fs.promises.readFile(file, 'utf8'), `AppState file ${file}`);
    logger.info('Loaded the persisted Facebook AppState from storage.');
    return stored;
  }

  if (!envSeed) throw new Error(`AppState file not found: ${file}. Set FB_APPSTATE_JSON for the first login or provide a valid APPSTATE_FILE.`);
  const initial = parseAppState(envSeed, 'FB_APPSTATE_JSON');
  await atomicWrite(file, JSON.stringify(initial));
  await atomicWrite(seedFile, seedFingerprint(envSeed));
  logger.info('Initial FB_APPSTATE_JSON copied to the configured AppState storage.');
  return initial;
}

async function connectMessenger(config) {
  // Unofficial session-emulation adapter. Keep it isolated here so it can be replaced.
  const login = require('@vangbanlanhat/fca-unofficial');
  const appState = await readAppState(config);
  const volumeMount = String(process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  if (volumeMount) {
    const relativeToVolume = path.relative(path.resolve(volumeMount), path.resolve(config.appStateFile));
    if (relativeToVolume.startsWith('..') || path.isAbsolute(relativeToVolume)) {
      logger.warn('APPSTATE_FILE is outside the Railway Volume mount; saved sessions may be lost on redeploy.', {
        appStateFile: path.resolve(config.appStateFile), volumeMount,
      });
    } else {
      logger.info('AppState file is inside the Railway persistent Volume.', { volumeMount, intervalMinutes: config.appStateSaveIntervalMinutes });
    }
  } else {
    logger.warn('No Railway persistent Volume was detected. AppState snapshots may be lost after redeploy. Attach a Volume and set APPSTATE_FILE to its mount path.');
  }
  logger.info('Connecting to Messenger using unofficial session emulation.');

  const api = await login(
    { appState },
    {
      listenEvents: true,
      autoReconnect: true,
      online: true,
      emitReady: true,
      selfListen: false,
      logLevel: config.logLevel,
    }
  );

  if (!api || typeof api.listenMqtt !== 'function') {
    throw new Error('Messenger library did not return a usable API object.');
  }
  if (typeof api.setOptions === 'function') {
    api.setOptions({
      listenEvents: true,
      autoReconnect: true,
      online: true,
      emitReady: true,
      selfListen: false,
      logLevel: config.logLevel,
    });
  }

  const currentUserID = typeof api.getCurrentUserID === 'function'
    ? String(await apiCall(api, 'getCurrentUserID'))
    : '';

  let appStateWriteChain = Promise.resolve();
  async function saveAppState(reason = 'manual') {
    if (typeof api.getAppState !== 'function') {
      throw new Error('The Messenger adapter does not expose getAppState(); current session cannot be snapshotted.');
    }
    const snapshot = await Promise.resolve(api.getAppState());
    if (!Array.isArray(snapshot) || !snapshot.length || snapshot.some(cookie => !cookie || typeof cookie !== 'object')) {
      throw new Error('getAppState() returned an invalid or empty cookie array; refusing to overwrite the last saved session.');
    }
    const file = path.resolve(config.appStateFile);
    const task = async () => {
      await atomicWrite(file, JSON.stringify(snapshot));
      logger.info('Facebook AppState snapshot saved to persistent storage.', { reason, cookieCount: snapshot.length });
    };
    appStateWriteChain = appStateWriteChain.then(task, task);
    await appStateWriteChain;
    return true;
  }

  // Preserve the latest cookie snapshot immediately after a successful login.
  await saveAppState('login');

  const mqtt = api.listenMqtt();
  if (!mqtt || typeof mqtt.on !== 'function') {
    throw new Error('Could not start the Messenger realtime listener.');
  }
  logger.info('Messenger listener started.', { currentUserID: currentUserID || 'unknown' });
  return { api, mqtt, currentUserID, saveAppState };
}

function apiCall(api, method, ...args) {
  return apiCallTimeout(api, method, 30000, ...args);
}

async function apiCallTimeout(api, method, timeoutMs, ...args) {
  const fn = api?.[method];
  if (typeof fn !== 'function') {
    throw new Error(`This Messenger adapter does not expose ${method}().`);
  }
  return await new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(value);
    };
    const callback = (err, value) => finish(err, value);
    try {
      // The adapter mixes callback, synchronous and Promise-based functions.
      const expectsCallback = fn.length > args.length;
      const result = expectsCallback ? fn.call(api, ...args, callback) : fn.call(api, ...args);
      if (result && typeof result.then === 'function') {
        result.then(value => finish(null, value), error => finish(error));
      } else if (result !== undefined) {
        finish(null, result);
      } else if (!expectsCallback) {
        finish(null, undefined);
      } else {
        timer = setTimeout(() => finish(new Error(`${method}() did not respond within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
        timer.unref?.();
      }
    } catch (error) {
      finish(error);
    }
  });
}

module.exports = { connectMessenger, apiCall, apiCallTimeout, readAppState };

  },
  "src/systems/jobs.js": function (require, module, exports) {
'use strict';

class JobManager {
  constructor() { this.jobs = new Map(); }
  #key(threadID, name) { return `${threadID}:${name}`; }
  set(threadID, name, handle) {
    const key = this.#key(threadID, name);
    this.cancel(threadID, name);
    this.jobs.set(key, handle);
  }
  cancel(threadID, name) {
    const key = this.#key(threadID, name);
    const handle = this.jobs.get(key);
    if (!handle) return false;
    if (typeof handle.cancel === 'function') handle.cancel();
    else { clearInterval(handle); clearTimeout(handle); }
    this.jobs.delete(key);
    return true;
  }
  cancelAll() {
    const count = this.jobs.size;
    for (const handle of this.jobs.values()) {
      if (typeof handle.cancel === 'function') handle.cancel();
      else { clearInterval(handle); clearTimeout(handle); }
    }
    this.jobs.clear();
    return count;
  }
}
module.exports = { JobManager };

  },
  "src/systems/monitor.js": function (require, module, exports) {
'use strict';

const { apiCall } = require('./fca');
const { sleep } = require('../utils/time');
const logger = require('../utils/logger');

async function scanThread(api, db, threadID, botUserID, primaryID) {
  const g = db.group(threadID);
  if (!g.nameProtection.enabled && !g.nickProtection.enabled && !g.blockedMembers.length) return;
  const info = await apiCall(api, 'getThreadInfo', threadID);
  const currentName = info?.threadName || info?.name || '';

  if (g.nameProtection.enabled && g.nameProtection.protectedName && currentName !== g.nameProtection.protectedName) {
    await apiCall(api, 'setTitle', g.nameProtection.protectedName, threadID);
    logger.info('Restored protected group title', { threadID });
  }

  if (g.nickProtection.enabled) {
    const rawNicknames = info?.nicknames || info?.participantNicknames || {};
    const current = rawNicknames instanceof Map ? Object.fromEntries(rawNicknames.entries()) : rawNicknames;
    for (const [userID, expected] of Object.entries(g.nickProtection.members || {})) {
      if (String(userID) === String(botUserID) || String(userID) === String(primaryID)) continue;
      if (String(current[userID] || '') !== String(expected)) {
        await apiCall(api, 'changeNickname', expected, threadID, userID);
        await sleep(700);
      }
    }
  }

  const blocked = new Set(g.blockedMembers || []);
  const present = (info?.participantIDs || []).map(String);
  for (const userID of present) {
    if (blocked.has(userID) && userID !== String(primaryID) && userID !== String(botUserID)) {
      await apiCall(api, 'removeUserFromGroup', userID, threadID);
      logger.info('Removed blocked rejoin member', { threadID, userID });
      await sleep(1000);
    }
  }
}

function startProtectionMonitor({ api, db, config, botUserID, primaryID }) {
  let running = false;
  const timer = setInterval(async () => {
    if (running || db.get('locked')) return;
    running = true;
    try {
      for (const threadID of db.get('activeThreads')) {
        try { await scanThread(api, db, threadID, botUserID, primaryID); }
        catch (error) { logger.warn('Protection scan failed', { threadID, error: error.message }); }
      }
    } finally { running = false; }
  }, config.protectionScanSeconds * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { startProtectionMonitor, scanThread };

  },
  "src/utils/format.js": function (require, module, exports) {
'use strict';

function frame(title, body, footer = 'ܢܔܠ 𝖳.') {
  return `﹙ ⠀@/ㅤ𝐓𝖺ha´𝓼⠀ ﹚\n\nヽ   𝖳. 𝖡𝗈𝗍 ᚲ 𝖲𝗒𝗌𝗍𝖾𝗆  ٫٫\n\n╭─── ${title} ───╮\n\n${body}\n\n╯────────────────╰\n\nㅤㅤㅤㅤ𝐓𝗋𝖺𝗂𝖼𝗂𝗈𝗇𝖾𝗋𝗈 ᚲ\n\n       ${footer}`;
}

const MAIN_MENU = `﹙ ⠀@/ㅤ𝐓𝖺ha´𝓼⠀ ﹚

ヽ   𝖳. 𝖡𝗈𝗍 ᚲ 𝖲𝗒𝗌𝗍𝖾𝗆  ٫٫

╭─── 𝖢𝖺𝗍𝖾𝗀𝗈𝗋𝗂𝖾𝗌 ───╮

𝟢𝟣. 𝖢𝗈𝗋𝖾 ㅤ   ㅤᚲ 𖣂︎
𝟢𝟤. 𝖦𝗋𝗈𝗎𝗉 ㅤㅤ
𝟢𝟥. 𝖯𝗋𝗈𝗍𝖾𝖼𝗍𝗂𝗈𝗇
𝟢𝟦. 𝖠𝗎𝗍𝗈 ㅤ       
𝟢𝟧. 𝖣𝖾𝗏𝖾𝗅𝗈𝗉𝖾𝗋
𝟢𝟨. 𝖬𝖾𝖽𝗂𝖺 ㅤㅤ
𝟢𝟩. 𝖠𝖽𝗏𝖺𝗇𝖼𝖾𝖽

╯────────────────╰

𝖲𝖾𝖾𝗄 𝗒𝗈𝗎𝗋 𝖼𝗈𝗆𝗆𝖺𝗇𝖽

𝑑𝑣.  .tp <category>
𝑑𝑣.  .help <command>
𝑑𝑣.  .tahabot

ㅤㅤㅤㅤ𝐓𝗋𝖺𝗂𝖼𝗂𝗈𝗇𝖾𝗋𝗈 ᚲ


       ܢܔܠ 𝖳.`;

function success(action, details = '') {
  return frame('𝖲𝗎𝖼𝖼𝖾𝗌𝗌 ᚲ', `𖣂︎ ${action}${details ? `\n\n${details}` : ''}`);
}
function error(message) { return frame('𝖤𝗋𝗋𝗈𝗋', `𖣂︎ ${message}`); }
function bilingual(ar, en) { return `${ar}\n\n${en}`; }
module.exports = { frame, MAIN_MENU, success, error, bilingual };

  },
  "src/utils/logger.js": function (require, module, exports) {
'use strict';

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const current = levels[process.env.LOG_LEVEL || 'info'] || levels.info;
function write(level, message, data) {
  if (levels[level] < current) return;
  const suffix = data ? ` ${JSON.stringify(data, (_, v) => v instanceof Error ? { message: v.message, stack: v.stack } : v)}` : '';
  console.log(`${new Date().toISOString()} [${level.toUpperCase()}] ${message}${suffix}`);
}
module.exports = {
  debug: (m, d) => write('debug', m, d),
  info: (m, d) => write('info', m, d),
  warn: (m, d) => write('warn', m, d),
  error: (m, d) => write('error', m, d),
};

  },
  "src/utils/parser.js": function (require, module, exports) {
'use strict';

function normalizeArabic(value) {
  return String(value || '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .trim()
    .toLowerCase();
}

function parseCommand(text, prefixes = ['.', '•', '—', '!']) {
  const source = String(text || '').trim();
  const prefix = prefixes.find(p => source.startsWith(p));
  if (!prefix) return null;
  const rest = source.slice(prefix.length).trim();
  if (!rest) return null;
  const firstSpace = rest.search(/\s/);
  const rawName = firstSpace < 0 ? rest : rest.slice(0, firstSpace);
  const argsText = firstSpace < 0 ? '' : rest.slice(firstSpace).trim();
  return {
    prefix,
    rawName,
    name: normalizeArabic(rawName.replace(/^\./, '')),
    argsText,
    args: argsText ? argsText.split(/\s+/) : [],
  };
}

function getMentionIDs(event) {
  const mentions = event?.mentions;
  if (!mentions) return [];
  if (Array.isArray(mentions)) return mentions.map(m => String(m.id || m.userID || '')).filter(Boolean);
  if (typeof mentions === 'object') return Object.keys(mentions).map(String);
  return [];
}

function getTargetID(ctx, explicitArg) {
  const reply = ctx.event?.messageReply || ctx.event?.replyMessage || ctx.event?.message_reply;
  const repliedID = reply?.senderID || reply?.author || reply?.userID;
  if (repliedID) return String(repliedID);
  const mentionIDs = getMentionIDs(ctx.event);
  if (mentionIDs.length) return mentionIDs[0];
  const candidate = String(explicitArg || '').match(/(?:profile\.php\?id=|\/)(\d{5,})|^(\d{5,})$/);
  return candidate ? String(candidate[1] || candidate[2]) : null;
}

module.exports = { normalizeArabic, parseCommand, getMentionIDs, getTargetID };

  },
  "src/utils/time.js": function (require, module, exports) {
'use strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = { sleep };

  }
};
const __cache = Object.create(null);

function __resolveLocal(request, parentId) {
  const base = __path.posix.dirname(parentId);
  let candidate = __path.posix.normalize(__path.posix.join(base, request));
  candidate = candidate.replace(/^\.\//, '');
  const options = candidate.endsWith('.js')
    ? [candidate]
    : [candidate, `${candidate}.js`, `${candidate}/index.js`];
  for (const option of options) {
    if (Object.prototype.hasOwnProperty.call(__modules, option)) return option;
  }
  throw new Error(`Cannot find bundled module "${request}" imported from "${parentId}"`);
}

function __load(id) {
  if (__cache[id]) return __cache[id].exports;
  const factory = __modules[id];
  if (!factory) throw new Error(`Bundled module not found: ${id}`);
  const module = { exports: {} };
  __cache[id] = module;
  const localRequire = request => {
    if (request.startsWith('./') || request.startsWith('../')) {
      return __load(__resolveLocal(request, id));
    }
    return __nativeRequire(request);
  };
  factory(localRequire, module, module.exports);
  return module.exports;
}

__load('index.js');
