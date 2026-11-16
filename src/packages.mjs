// What a repository's files say about the skills behind it, without reading any prose:
//  - GitHub's language statistics          -> languages
//  - dependency files (package.json, ...)   -> frameworks, databases, clouds, ML libraries
//  - tell-tale files (Dockerfile, *.tf, ...) -> tools and practices
// Every name produced here is one the skill vocabulary (public/skills.mjs) already knows or treats as technical.

/** GitHub's language names -> skill names. Languages not listed are ignored (Makefile, Batchfile, ...). */
export const LANGUAGES = {
  'JavaScript': ['JavaScript'], 'TypeScript': ['TypeScript'], 'Python': ['Python'], 'Jupyter Notebook': ['Python', 'Jupyter'],
  'Java': ['Java'], 'Kotlin': ['Kotlin'], 'Go': ['Go'], 'Rust': ['Rust'], 'C': ['C'], 'C++': ['C++'], 'C#': ['C#'],
  'Swift': ['Swift'], 'Objective-C': ['Objective-C'], 'Ruby': ['Ruby'], 'PHP': ['PHP'], 'Scala': ['Scala'], 'Elixir': ['Elixir'],
  'Erlang': ['Erlang'], 'Dart': ['Dart'], 'R': ['R'], 'MATLAB': ['MATLAB'], 'Julia': ['Julia'], 'Haskell': ['Haskell'],
  'Solidity': ['Solidity'], 'Shell': ['Bash'], 'PowerShell': ['PowerShell'], 'HTML': ['HTML'], 'CSS': ['CSS'], 'SCSS': ['CSS'],
  'Vue': ['Vue'], 'Svelte': ['Svelte'], 'HCL': ['Terraform'], 'Dockerfile': ['Docker'], 'Verilog': ['FPGA'], 'SystemVerilog': ['FPGA'],
  'VHDL': ['FPGA'], 'Assembly': ['Assembly'], 'Lua': ['Lua'], 'TeX': ['LaTeX'], 'GLSL': ['OpenGL'], 'HLSL': ['Unity'], 'ShaderLab': ['Unity'],
  'Arduino': ['Arduino'], 'CUDA': ['CUDA'], 'Zig': ['Zig'], 'OCaml': ['OCaml'], 'F#': ['F#'], 'Clojure': ['Clojure'], 'Perl': ['Perl'],
};

// [pattern, skills]. A pattern is an exact package name, a prefix ending in '*', or a RegExp.
const NPM = [
  ['react', ['React']], ['react-dom', ['React']], ['next', ['Next.js', 'React']], ['vue', ['Vue']], ['nuxt', ['Nuxt', 'Vue']], ['@angular/core', ['Angular']],
  ['svelte', ['Svelte']], ['@sveltejs/kit', ['Svelte']], ['redux', ['Redux']], ['@reduxjs/toolkit', ['Redux']], ['zustand', ['Zustand']], ['tailwindcss', ['Tailwind']],
  ['three', ['Three.js']], ['@react-three/fiber', ['Three.js']], ['react-native', ['React Native']], ['expo', ['Expo', 'React Native']], ['electron', ['Electron']],
  ['@tauri-apps/api', ['Tauri']], ['express', ['Express', 'Node.js']], ['@nestjs/core', ['NestJS', 'Node.js']], ['fastify', ['Node.js']], ['koa', ['Node.js']], ['hono', ['Node.js']],
  ['graphql', ['GraphQL']], ['@apollo/*', ['GraphQL']], ['socket.io', ['WebSockets']], ['socket.io-client', ['WebSockets']], ['ws', ['WebSockets']],
  ['mongoose', ['MongoDB']], ['mongodb', ['MongoDB']], ['pg', ['PostgreSQL']], ['postgres', ['PostgreSQL']], ['mysql2', ['MySQL']], ['mysql', ['MySQL']],
  ['redis', ['Redis']], ['ioredis', ['Redis']], ['prisma', ['Prisma']], ['@prisma/client', ['Prisma']], ['drizzle-orm', ['SQL']], ['sequelize', ['SQL']], ['typeorm', ['SQL']], ['knex', ['SQL']],
  ['@supabase/supabase-js', ['Supabase', 'PostgreSQL']], ['firebase', ['Firebase']], ['firebase-admin', ['Firebase']],
  ['aws-sdk', ['AWS']], ['@aws-sdk/*', ['AWS']], ['aws-cdk-lib', ['AWS']], ['@google-cloud/*', ['GCP']], ['@azure/*', ['Azure']],
  ['openai', ['OpenAI', 'LLMs']], ['@anthropic-ai/sdk', ['LLMs']], ['langchain', ['LangChain', 'LLMs']], ['@langchain/*', ['LangChain', 'LLMs']], ['ai', ['LLMs']],
  ['@tensorflow/tfjs', ['TensorFlow']], ['@huggingface/*', ['Hugging Face']], ['@pinecone-database/pinecone', ['Pinecone']], ['chromadb', ['Chroma']],
  ['typescript', ['TypeScript']], ['jest', ['Jest']], ['vitest', ['Vitest']], ['mocha', ['Mocha']], ['cypress', ['Cypress']], ['@playwright/test', ['Playwright']], ['playwright', ['Playwright']],
  ['puppeteer', ['Puppeteer']], ['@testing-library/*', ['Testing']], ['storybook', ['Storybook']], ['@storybook/*', ['Storybook']],
  ['webpack', ['Webpack']], ['vite', ['Vite']], ['kafkajs', ['Kafka']], ['amqplib', ['RabbitMQ']], ['@grpc/grpc-js', ['gRPC']], ['bullmq', ['Redis']],
  ['ethers', ['Web3']], ['web3', ['Web3']], ['hardhat', ['Solidity', 'Web3']], ['wagmi', ['Web3']], ['jsonwebtoken', ['JWT']], ['passport', ['OAuth']], ['next-auth', ['OAuth']],
  ['d3', ['D3.js']], ['chart.js', ['Chart.js']], ['@mui/material', ['Material UI']], ['bootstrap', ['Bootstrap']], ['stripe', ['Stripe']], ['@stripe/*', ['Stripe']],
  ['@sentry/*', ['Sentry']], ['prom-client', ['Prometheus']], ['@opentelemetry/*', ['Observability']], ['dockerode', ['Docker']], ['@kubernetes/client-node', ['Kubernetes']],
];
const PYPI = [
  ['django', ['Django']], ['djangorestframework', ['Django', 'REST']], ['flask', ['Flask']], ['fastapi', ['FastAPI']], ['starlette', ['FastAPI']], ['uvicorn', ['FastAPI']],
  ['torch', ['PyTorch']], ['torchvision', ['PyTorch', 'Computer Vision']], ['pytorch-lightning', ['PyTorch']], ['lightning', ['PyTorch']], ['tensorflow', ['TensorFlow']], ['tensorflow-*', ['TensorFlow']],
  ['keras', ['Keras']], ['jax', ['JAX']], ['flax', ['JAX']], ['scikit-learn', ['scikit-learn', 'Machine Learning']], ['sklearn', ['scikit-learn', 'Machine Learning']],
  ['xgboost', ['XGBoost', 'Machine Learning']], ['lightgbm', ['Machine Learning']], ['catboost', ['Machine Learning']],
  ['pandas', ['Pandas']], ['polars', ['Pandas']], ['numpy', ['NumPy']], ['scipy', ['NumPy']], ['matplotlib', ['Matplotlib']], ['seaborn', ['Seaborn']], ['plotly', ['Data Visualization']],
  ['transformers', ['Hugging Face', 'Transformers']], ['datasets', ['Hugging Face']], ['huggingface-hub', ['Hugging Face']], ['huggingface_hub', ['Hugging Face']], ['accelerate', ['Hugging Face']], ['peft', ['Hugging Face', 'LLMs']],
  ['sentence-transformers', ['Hugging Face', 'Vector Embeddings']], ['langchain', ['LangChain', 'LLMs']], ['langchain-*', ['LangChain', 'LLMs']], ['langgraph', ['LangGraph', 'LLMs']],
  ['llama-index', ['LlamaIndex', 'LLMs']], ['llama_index', ['LlamaIndex', 'LLMs']], ['openai', ['OpenAI', 'LLMs']], ['anthropic', ['LLMs']], ['tiktoken', ['LLMs']], ['vllm', ['LLMs']], ['ollama', ['Ollama', 'LLMs']],
  ['faiss-cpu', ['FAISS', 'Vector Embeddings']], ['faiss-gpu', ['FAISS', 'Vector Embeddings']], ['chromadb', ['Chroma', 'Vector Embeddings']], ['pinecone-client', ['Pinecone']], ['pinecone', ['Pinecone']], ['qdrant-client', ['Qdrant']], ['weaviate-client', ['Weaviate']],
  ['opencv-python', ['OpenCV', 'Computer Vision']], ['opencv-python-headless', ['OpenCV', 'Computer Vision']], ['opencv-contrib-python', ['OpenCV', 'Computer Vision']], ['ultralytics', ['Computer Vision']], ['timm', ['Computer Vision', 'PyTorch']], ['albumentations', ['Computer Vision']],
  ['nltk', ['NLP']], ['spacy', ['NLP']], ['gensim', ['NLP']], ['openai-whisper', ['Whisper', 'Speech Recognition']], ['librosa', ['Speech Recognition']],
  ['sqlalchemy', ['SQLAlchemy', 'SQL']], ['psycopg2', ['PostgreSQL']], ['psycopg2-binary', ['PostgreSQL']], ['psycopg', ['PostgreSQL']], ['asyncpg', ['PostgreSQL']], ['pymysql', ['MySQL']], ['mysqlclient', ['MySQL']],
  ['pymongo', ['MongoDB']], ['motor', ['MongoDB']], ['redis', ['Redis']], ['celery', ['Celery']], ['apache-airflow', ['Airflow']], ['pyspark', ['Spark']], ['dbt-core', ['dbt']], ['dbt-*', ['dbt']],
  ['snowflake-connector-python', ['Snowflake']], ['google-cloud-bigquery', ['BigQuery', 'GCP']], ['boto3', ['AWS']], ['botocore', ['AWS']], ['google-cloud-*', ['GCP']], ['azure-*', ['Azure']], ['firebase-admin', ['Firebase']],
  ['pytest', ['pytest']], ['selenium', ['Selenium']], ['playwright', ['Playwright']], ['streamlit', ['Streamlit']], ['gradio', ['Gradio']], ['mlflow', ['MLflow']], ['wandb', ['Weights & Biases']],
  ['kafka-python', ['Kafka']], ['confluent-kafka', ['Kafka']], ['pika', ['RabbitMQ']], ['grpcio', ['gRPC']], ['web3', ['Web3']], ['pygame', ['Game Development']], ['rclpy', ['ROS']],
  ['onnx', ['ONNX']], ['onnxruntime', ['ONNX']], ['tensorrt', ['CUDA']], ['pycuda', ['CUDA']], ['cupy', ['CUDA']], ['ray', ['Distributed Systems']], ['dask', ['Distributed Systems']],
  ['docker', ['Docker']], ['kubernetes', ['Kubernetes']], ['prometheus-client', ['Prometheus']], ['sentry-sdk', ['Sentry']], ['pydantic', ['Python']],
];
const GO = [
  ['github.com/gin-gonic/gin', ['REST']], ['github.com/labstack/echo*', ['REST']], ['github.com/gofiber/fiber*', ['REST']], ['github.com/go-chi/chi*', ['REST']],
  ['github.com/redis/go-redis*', ['Redis']], ['github.com/go-redis/redis*', ['Redis']], ['github.com/jackc/pgx*', ['PostgreSQL']], ['github.com/lib/pq', ['PostgreSQL']],
  ['go.mongodb.org/mongo-driver*', ['MongoDB']], ['google.golang.org/grpc', ['gRPC']], ['github.com/aws/aws-sdk-go*', ['AWS']], ['cloud.google.com/go*', ['GCP']],
  ['k8s.io/client-go', ['Kubernetes']], ['sigs.k8s.io/controller-runtime', ['Kubernetes']], ['github.com/segmentio/kafka-go', ['Kafka']], ['github.com/IBM/sarama', ['Kafka']], ['github.com/Shopify/sarama', ['Kafka']],
  ['github.com/confluentinc/confluent-kafka-go*', ['Kafka']], ['github.com/gorilla/websocket', ['WebSockets']], ['github.com/prometheus/client_golang', ['Prometheus']],
  ['go.opentelemetry.io/*', ['Observability']], ['github.com/99designs/gqlgen', ['GraphQL']], ['github.com/graphql-go/graphql', ['GraphQL']], ['gorm.io/gorm', ['SQL']],
  ['github.com/docker/docker', ['Docker']], ['github.com/rabbitmq/amqp091-go', ['RabbitMQ']], ['github.com/streadway/amqp', ['RabbitMQ']],
];
const CARGO = [
  ['tokio', ['Tokio']], ['actix-web', ['REST']], ['axum', ['REST']], ['rocket', ['REST']], ['warp', ['REST']], ['tonic', ['gRPC']], ['sqlx', ['SQL']], ['diesel', ['SQL']],
  ['wasm-bindgen', ['WebAssembly']], ['bevy', ['Game Development']], ['redis', ['Redis']], ['mongodb', ['MongoDB']], ['aws-sdk-*', ['AWS']], ['tch', ['PyTorch']], ['candle-core', ['Machine Learning']],
];
const MAVEN = [ // group:artifact
  [/^org\.springframework\.boot:/, ['Spring Boot']], [/^org\.springframework/, ['Spring']], [/^org\.hibernate/, ['Hibernate', 'SQL']], [/^junit:|^org\.junit/, ['JUnit']],
  [/^org\.apache\.kafka:/, ['Kafka']], [/^org\.postgresql:/, ['PostgreSQL']], [/^mysql:|^com\.mysql:/, ['MySQL']], [/^org\.mongodb:/, ['MongoDB']], [/^redis\.clients:|^io\.lettuce:/, ['Redis']],
  [/^software\.amazon\.awssdk:|^com\.amazonaws:/, ['AWS']], [/^com\.google\.cloud:/, ['GCP']], [/^io\.grpc:/, ['gRPC']], [/^androidx\.compose|^androidx\.compose\./, ['Jetpack Compose', 'Android']],
  [/^androidx\./, ['Android']], [/^com\.google\.firebase:/, ['Firebase']], [/^org\.jetbrains\.kotlinx?:kotlinx-coroutines/, ['Kotlin']], [/^io\.ktor:/, ['Kotlin']], [/^org\.tensorflow:/, ['TensorFlow']],
  [/^com\.squareup\.retrofit2:/, ['REST', 'Android']], [/^org\.apache\.spark:/, ['Spark']], [/^org\.seleniumhq/, ['Selenium']],
];
const GEM = [['rails', ['Rails', 'Ruby']], ['sinatra', ['Ruby']], ['rspec', ['Testing']], ['rspec-rails', ['Testing']], ['pg', ['PostgreSQL']], ['mysql2', ['MySQL']], ['redis', ['Redis']], ['sidekiq', ['Redis']], ['graphql', ['GraphQL']], ['aws-sdk-*', ['AWS']]];
const COMPOSER = [['laravel/framework', ['Laravel', 'PHP']], ['symfony/*', ['Symfony', 'PHP']], ['phpunit/phpunit', ['Testing']], ['predis/predis', ['Redis']], ['aws/aws-sdk-php', ['AWS']], ['doctrine/orm', ['SQL']]];
const PUB = [['flutter', ['Flutter', 'Dart']], ['firebase_core', ['Firebase']], ['cloud_firestore', ['Firebase']], ['flutter_bloc', ['Flutter']], ['provider', ['Flutter']], ['riverpod', ['Flutter']], ['flutter_riverpod', ['Flutter']], ['dio', ['REST']], ['http', ['REST']], ['sqflite', ['SQL']], ['flutter_webrtc', ['WebRTC']], ['web_socket_channel', ['WebSockets']], ['google_mlkit_*', ['Machine Learning']], ['tflite_flutter', ['TensorFlow']]];
const NUGET = [[/^Microsoft\.AspNetCore/, ['.NET']], [/^Microsoft\.EntityFrameworkCore/, ['.NET', 'SQL']], [/^Npgsql/, ['PostgreSQL']], [/^StackExchange\.Redis/, ['Redis']], [/^AWSSDK\./, ['AWS']], [/^Azure\./, ['Azure']], [/^xunit|^NUnit|^MSTest/, ['Testing']], [/^Unity/, ['Unity']], [/^Grpc\./, ['gRPC']]];
const TABLES = { npm: NPM, pypi: PYPI, go: GO, cargo: CARGO, maven: MAVEN, gem: GEM, composer: COMPOSER, pub: PUB, nuget: NUGET };

const norm = (eco, n) => eco === 'pypi' ? String(n).toLowerCase().replace(/[_.]+/g, '-').replace(/\[.*$/, '') : String(n).trim();
/** Skills one dependency points to, e.g. ('pypi', 'torch') -> ['PyTorch']. */
export function skillsForPackage(eco, name) {
  const n = norm(eco, name); if (!n) return [];
  const pypiAlt = eco === 'pypi' ? n.replace(/-/g, '_') : null;
  for (const [pat, skills] of TABLES[eco] || []) {
    if (pat instanceof RegExp ? pat.test(n) : pat.endsWith('*') ? n.startsWith(pat.slice(0, -1)) : (n === pat || (pypiAlt && pypiAlt === pat))) return skills;
  }
  return [];
}

// ── reading dependency files ───────────────────────────────────────────────────────────────────────────
const lines = t => String(t || '').split(/\r?\n/);
/** Which dependency files Lookout reads, by file name. Each returns [{ eco, name }]. */
export const MANIFESTS = {
  'package.json': t => { try { const j = JSON.parse(t); return Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies }).map(name => ({ eco: 'npm', name })); } catch { return []; } },
  'requirements.txt': t => lines(t).map(l => l.replace(/#.*/, '').trim()).filter(l => l && !l.startsWith('-')).map(l => ({ eco: 'pypi', name: l.split(/[<>=!~;\s[@]/)[0] })),
  'pyproject.toml': t => {
    const out = []; let inDeps = false, inPoetry = false;
    for (const raw of lines(t)) {
      const l = raw.trim();
      if (/^\[/.test(l)) { inPoetry = /^\[tool\.poetry\.(?:dev-)?dependencies\]|^\[tool\.poetry\.group\.[^\]]+\.dependencies\]/.test(l); inDeps = false; continue; }
      if (/^(?:dependencies|optional-dependencies|dev-dependencies)\s*=\s*\[/.test(l) || /^[\w-]+\s*=\s*\[/.test(l) && inDeps) inDeps = true;
      if (inPoetry) { const k = l.match(/^([A-Za-z0-9_.-]+)\s*=/)?.[1]; if (k && k !== 'python') out.push({ eco: 'pypi', name: k }); continue; }
      for (const m of l.matchAll(/["']([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(?:[<>=!~;].*?)?["']/g)) if (inDeps || /^dependencies\s*=/.test(l)) out.push({ eco: 'pypi', name: m[1] });
      if (l.includes(']') && !l.includes('[')) inDeps = false;
    }
    return out;
  },
  'Pipfile': t => { const out = []; let on = false; for (const l of lines(t)) { if (/^\[/.test(l.trim())) { on = /^\[(dev-)?packages\]/.test(l.trim()); continue; } const k = on && l.match(/^\s*"?([A-Za-z0-9_.-]+)"?\s*=/)?.[1]; if (k) out.push({ eco: 'pypi', name: k }); } return out; },
  'setup.py': t => [...String(t).matchAll(/["']([A-Za-z0-9_.-]+)\s*(?:[<>=!~][^"']*)?["']/g)].map(m => m[1]).filter(n => skillsForPackage('pypi', n).length).map(name => ({ eco: 'pypi', name })),
  'environment.yml': t => lines(t).map(l => l.match(/^\s*-\s*([A-Za-z0-9_.-]+)/)?.[1]).filter(Boolean).map(name => ({ eco: 'pypi', name })),
  'go.mod': t => lines(t).map(l => l.trim().replace(/^require\s+/, '').match(/^([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v/)?.[1]).filter(Boolean).map(name => ({ eco: 'go', name })),
  'Cargo.toml': t => { const out = []; let on = false; for (const l of lines(t)) { if (/^\[/.test(l.trim())) { on = /dependencies\]$/.test(l.trim()); continue; } const k = on && l.match(/^\s*([A-Za-z0-9_-]+)\s*=/)?.[1]; if (k) out.push({ eco: 'cargo', name: k }); } return out; },
  'pom.xml': t => [...String(t).matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)].map(m => ({ eco: 'maven', name: `${m[1].trim()}:${m[2].trim()}` })),
  'build.gradle': t => [...String(t).matchAll(/["']([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::[^"']*)?["']/g)].map(m => ({ eco: 'maven', name: `${m[1]}:${m[2]}` })),
  'build.gradle.kts': t => MANIFESTS['build.gradle'](t),
  'Gemfile': t => [...String(t).matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map(m => ({ eco: 'gem', name: m[1] })),
  'composer.json': t => { try { const j = JSON.parse(t); return Object.keys({ ...j.require, ...j['require-dev'] }).map(name => ({ eco: 'composer', name })); } catch { return []; } },
  'pubspec.yaml': t => { const out = []; let on = false; for (const l of lines(t)) { if (/^\S/.test(l)) { on = /^(dev_)?dependencies:/.test(l); continue; } const k = on && l.match(/^ {2}([a-z0-9_]+):/)?.[1]; if (k) out.push({ eco: 'pub', name: k }); } return out; },
};
export const isManifest = file => file in MANIFESTS || /\.csproj$/i.test(file);
export function readManifest(file, text) {
  if (/\.csproj$/i.test(file)) return [...String(text).matchAll(/<PackageReference\s+Include="([^"]+)"/gi)].map(m => ({ eco: 'nuget', name: m[1] }));
  return (MANIFESTS[file] || (() => []))(text);
}

/** Files whose presence alone says something. Paths are relative to the repository root. */
export const FILE_SIGNS = [
  [/(^|\/)Dockerfile$|(^|\/)docker-compose\.ya?ml$|(^|\/)compose\.ya?ml$/i, ['Docker']],
  [/^\.github\/workflows\/[^/]+\.ya?ml$/i, ['GitHub Actions', 'CI/CD']], [/(^|\/)\.gitlab-ci\.yml$|(^|\/)Jenkinsfile$|(^|\/)\.circleci\//i, ['CI/CD']],
  [/\.tf$/i, ['Terraform']], [/(^|\/)Chart\.yaml$/i, ['Helm', 'Kubernetes']], [/(^|\/)(k8s|kubernetes|manifests|deploy)\/[^/]+\.ya?ml$|(^|\/)kustomization\.ya?ml$/i, ['Kubernetes']],
  [/(^|\/)serverless\.ya?ml$/i, ['Serverless', 'AWS']], [/(^|\/)vercel\.json$/i, ['Vercel']], [/(^|\/)netlify\.toml$/i, ['Netlify']], [/(^|\/)firebase\.json$/i, ['Firebase']],
  [/(^|\/)wrangler\.toml$/i, ['Cloudflare']], [/(^|\/)schema\.prisma$/i, ['Prisma']], [/\.ipynb$/i, ['Jupyter']], [/(^|\/)CMakeLists\.txt$/i, ['C++']],
  [/\.ino$/i, ['Arduino', 'Embedded']], [/(^|\/)platformio\.ini$/i, ['Embedded']], [/(^|\/)package\.xml$/i, ['ROS']], [/^ProjectSettings\/ProjectVersion\.txt$/i, ['Unity']],
  [/\.sol$/i, ['Solidity']], [/\.proto$/i, ['gRPC']], [/\.graphql$|\.gql$/i, ['GraphQL']], [/(^|\/)AndroidManifest\.xml$/i, ['Android']], [/\.xcodeproj\//i, ['iOS']],
  [/(^|\/)nginx\.conf$/i, ['Nginx']], [/(^|\/)ansible\.cfg$|(^|\/)playbook\.ya?ml$/i, ['Ansible']], [/(^|\/)tailwind\.config\.[cm]?[jt]s$/i, ['Tailwind']],
  [/(^|\/)openapi\.(ya?ml|json)$|(^|\/)swagger\.(ya?ml|json)$/i, ['REST']], [/(^|\/)\.?storybook\//i, ['Storybook']], [/(^|\/)playwright\.config\.[jt]s$/i, ['Playwright']], [/(^|\/)cypress\.config\.[jt]s$/i, ['Cypress']],
];
export function fileSigns(paths) {
  const out = new Map(); // skill -> first file that showed it
  for (const p of paths) for (const [re, skills] of FILE_SIGNS) if (re.test(p)) for (const s of skills) if (!out.has(s)) out.set(s, p);
  return out;
}
