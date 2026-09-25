// pm2 (VPS): mantém o Next.js sempre ligado e reinicia após reboot.
//   npm ci && npm run build && pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'swissmarket',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3000',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
    },
  ],
};
