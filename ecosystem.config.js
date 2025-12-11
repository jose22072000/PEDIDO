module.exports = {
  apps: [
    {
      name: 'procavar-api',
      script: 'dist/index.js',
      cwd: './api',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 8400,
        DATABASE_URL: 'file:./prisma/dev.db',
        JWT_SECRET: 'JFBOASOIDHBAUcioaboscboaishghebrfgiOPHGHFPAOISGHDB',
        CORS_ORIGIN: '*'
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'procavar-frontend',
      script: "C:\\nvm4w\\nodejs\\node_modules\\serve\\build\\main.js",
      args: ['dist', '--single', '--listen', '5000'],
      cwd: './front',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1024M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    }
  ]
};
