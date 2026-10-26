/**
 * Skill taxonomy — the shared vocabulary for resumes, job requirements and matching.
 * `aliases` are matched case-insensitively on word boundaries. Keep aliases specific:
 * a loose alias ("go", "r", "c") produces false positives in prose, so those use
 * context-safe forms only.
 */
export type Skill = { slug: string; name: string; category: SkillCategory; aliases: string[] };
export type SkillCategory =
  | "language" | "frontend" | "backend" | "data" | "ml" | "cloud" | "devops"
  | "database" | "mobile" | "testing" | "security" | "systems" | "tools" | "cs" | "design";

const s = (slug: string, name: string, category: SkillCategory, aliases: string[] = []): Skill => ({
  slug, name, category, aliases: [name.toLowerCase(), ...aliases],
});

export const SKILLS: Skill[] = [
  // languages
  s("python", "Python", "language"),
  s("java", "Java", "language", ["java 17", "java se"]),
  s("javascript", "JavaScript", "language", ["js", "ecmascript", "es6"]),
  s("typescript", "TypeScript", "language", ["ts"]),
  s("c", "C", "language", ["c programming", "ansi c", "c/c++"]),
  s("cpp", "C++", "language", ["cpp", "c/c++", "modern c++"]),
  s("csharp", "C#", "language", ["c sharp", ".net c#"]),
  s("go", "Go", "language", ["golang", "go lang", "go (golang)"]),
  s("rust", "Rust", "language"),
  s("kotlin", "Kotlin", "language"),
  s("swift", "Swift", "language"),
  s("ruby", "Ruby", "language"),
  s("php", "PHP", "language"),
  s("scala", "Scala", "language"),
  s("r", "R", "language", ["r programming", "rstudio", "r language"]),
  s("matlab", "MATLAB", "language"),
  s("sql", "SQL", "database", ["t-sql", "pl/sql", "sql queries"]),
  s("bash", "Bash", "tools", ["shell scripting", "shell script", "unix shell", "zsh"]),
  s("verilog", "Verilog", "systems", ["systemverilog", "system verilog"]),
  s("vhdl", "VHDL", "systems"),
  s("assembly", "Assembly", "systems", ["x86 assembly", "arm assembly"]),
  // frontend
  s("react", "React", "frontend", ["react.js", "reactjs"]),
  s("nextjs", "Next.js", "frontend", ["nextjs", "next js"]),
  s("vue", "Vue", "frontend", ["vue.js", "vuejs"]),
  s("angular", "Angular", "frontend", ["angularjs"]),
  s("svelte", "Svelte", "frontend", ["sveltekit"]),
  s("html", "HTML", "frontend", ["html5"]),
  s("css", "CSS", "frontend", ["css3", "scss", "sass"]),
  s("tailwind", "Tailwind CSS", "frontend", ["tailwind", "tailwindcss"]),
  s("redux", "Redux", "frontend"),
  s("threejs", "Three.js", "frontend", ["threejs", "webgl"]),
  // backend
  s("nodejs", "Node.js", "backend", ["node", "nodejs", "node js"]),
  s("express", "Express", "backend", ["express.js", "expressjs"]),
  s("spring", "Spring Boot", "backend", ["spring", "spring framework", "springboot"]),
  s("django", "Django", "backend"),
  s("flask", "Flask", "backend"),
  s("fastapi", "FastAPI", "backend"),
  s("dotnet", ".NET", "backend", ["asp.net", "dotnet", ".net core"]),
  s("rails", "Ruby on Rails", "backend", ["rails"]),
  s("rest", "REST APIs", "backend", ["rest api", "restful", "rest apis", "restful apis", "rest"]),
  s("graphql", "GraphQL", "backend"),
  s("grpc", "gRPC", "backend"),
  s("microservices", "Microservices", "backend", ["microservice", "service-oriented architecture"]),
  s("kafka", "Kafka", "backend", ["apache kafka"]),
  s("rabbitmq", "RabbitMQ", "backend"),
  // databases
  s("postgres", "PostgreSQL", "database", ["postgres", "postgresql", "psql"]),
  s("mysql", "MySQL", "database"),
  s("mongodb", "MongoDB", "database", ["mongo"]),
  s("redis", "Redis", "database"),
  s("dynamodb", "DynamoDB", "database"),
  s("cassandra", "Cassandra", "database"),
  s("elasticsearch", "Elasticsearch", "database", ["elastic search", "opensearch"]),
  s("sqlite", "SQLite", "database"),
  s("snowflake", "Snowflake", "data"),
  s("bigquery", "BigQuery", "data"),
  // data
  s("pandas", "pandas", "data"),
  s("numpy", "NumPy", "data"),
  s("spark", "Apache Spark", "data", ["spark", "pyspark"]),
  s("hadoop", "Hadoop", "data"),
  s("airflow", "Airflow", "data", ["apache airflow"]),
  s("dbt", "dbt", "data"),
  s("etl", "ETL", "data", ["etl pipelines", "data pipelines", "elt"]),
  s("tableau", "Tableau", "data"),
  s("powerbi", "Power BI", "data", ["powerbi"]),
  s("excel", "Excel", "data", ["microsoft excel", "spreadsheets"]),
  s("statistics", "Statistics", "data", ["statistical analysis", "probability"]),
  // ml
  s("ml", "Machine Learning", "ml", ["machine learning", "ml"]),
  s("deep-learning", "Deep Learning", "ml", ["deep learning", "neural networks"]),
  s("pytorch", "PyTorch", "ml"),
  s("tensorflow", "TensorFlow", "ml", ["keras"]),
  s("scikit-learn", "scikit-learn", "ml", ["sklearn", "scikit learn"]),
  s("nlp", "NLP", "ml", ["natural language processing"]),
  s("computer-vision", "Computer Vision", "ml", ["computer vision", "opencv"]),
  s("llm", "LLMs", "ml", ["large language models", "llm", "llms", "generative ai", "genai", "prompt engineering"]),
  s("rag", "RAG", "ml", ["retrieval augmented generation", "retrieval-augmented generation"]),
  s("cuda", "CUDA", "ml", ["gpu programming"]),
  s("reinforcement-learning", "Reinforcement Learning", "ml", ["reinforcement learning"]),
  // cloud & devops
  s("aws", "AWS", "cloud", ["amazon web services", "ec2", "aws lambda"]),
  s("gcp", "Google Cloud", "cloud", ["gcp", "google cloud platform"]),
  s("azure", "Azure", "cloud", ["microsoft azure"]),
  s("docker", "Docker", "devops", ["containerization"]),
  s("kubernetes", "Kubernetes", "devops", ["k8s"]),
  s("terraform", "Terraform", "devops", ["infrastructure as code", "iac"]),
  s("ci-cd", "CI/CD", "devops", ["ci/cd", "continuous integration", "github actions", "jenkins", "gitlab ci"]),
  s("linux", "Linux", "systems", ["unix"]),
  s("git", "Git", "tools", ["github", "version control", "gitlab"]),
  // Bare "monitoring" is not a skill: campus postings monitor climbers and budgets (found live 2026-10-25); see CONTEXT_MATCHERS.
  s("observability", "Observability", "devops", ["prometheus", "grafana", "datadog"]),
  // mobile
  s("ios", "iOS", "mobile", ["ios development", "swiftui", "uikit"]),
  s("android", "Android", "mobile", ["android development", "jetpack compose"]),
  s("react-native", "React Native", "mobile"),
  s("flutter", "Flutter", "mobile", ["dart"]),
  // testing
  s("unit-testing", "Unit Testing", "testing", ["unit tests", "junit", "pytest", "jest", "vitest", "test-driven development", "tdd"]),
  s("test-automation", "Test Automation", "testing", ["selenium", "cypress", "playwright", "automated testing", "test automation"]),
  s("qa", "QA", "testing", ["quality assurance", "sdet", "software testing"]),
  // security
  // "Information Security Standards as a condition of employment" is HR boilerplate, not a skill; see CONTEXT_MATCHERS.
  s("cybersecurity", "Cybersecurity", "security", ["security", "infosec"]),
  s("network-security", "Network Security", "security", ["firewalls", "ids/ips"]),
  s("penetration-testing", "Penetration Testing", "security", ["pentesting", "pen testing", "ethical hacking"]),
  s("cryptography", "Cryptography", "security", ["encryption"]),
  // systems & hardware
  s("embedded", "Embedded Systems", "systems", ["embedded", "firmware", "microcontrollers", "rtos"]),
  s("operating-systems", "Operating Systems", "systems", ["operating systems", "os internals", "kernel"]),
  s("networking", "Networking", "systems", ["tcp/ip", "computer networks", "network protocols"]),
  s("distributed-systems", "Distributed Systems", "systems", ["distributed systems", "distributed computing"]),
  s("concurrency", "Concurrency", "systems", ["multithreading", "multi-threading", "parallel programming"]),
  s("fpga", "FPGA", "systems"),
  s("computer-architecture", "Computer Architecture", "systems", ["computer architecture", "cpu architecture"]),
  // CS fundamentals
  s("dsa", "Data Structures", "cs", ["data structures", "data structures and algorithms", "dsa"]),
  s("algorithms", "Algorithms", "cs", ["algorithms", "algorithm design"]),
  s("oop", "Object-Oriented Programming", "cs", ["object-oriented", "object oriented", "oop", "ood"]),
  s("system-design", "System Design", "cs", ["system design", "software architecture", "scalable systems"]),
  s("agile", "Agile", "tools", ["scrum", "agile development", "jira"]),
  // design
  s("figma", "Figma", "design"),
  s("ui-ux", "UI/UX", "design", ["ui/ux", "user experience", "user interface design", "ux design"]),
];

const BY_SLUG = new Map(SKILLS.map((k) => [k.slug, k]));
export const skillBySlug = (slug: string) => BY_SLUG.get(slug);

// Single-letter / ambiguous names that must not be matched as bare words.
const UNSAFE_BARE = new Set(["c", "r", "go", "rest", "ts", "js", "node", "spark", "security", "rails", "embedded", "ml", "unix", "excel", "express", "spring"]);

function escape(re: string) {
  return re.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Matcher = { slug: string; re: RegExp };
const MATCHERS: Matcher[] = SKILLS.flatMap((k) =>
  [...new Set(k.aliases)]
    .filter((a) => !UNSAFE_BARE.has(a))
    .map((a) => ({
      slug: k.slug,
      // letters/digits on either side break the match; allow +, #, . inside the alias itself
      re: new RegExp(`(?<![a-z0-9+#])${escape(a)}(?![a-z0-9+#])`, "i"),
    })),
);

// Context-safe patterns for the ambiguous ones.
const CONTEXT_MATCHERS: Matcher[] = [
  { slug: "c", re: /(?<![a-z0-9+#])c(?=\s*(?:,|\/|and|or)\s*c\+\+)|\bc programming\b|\bin c\b(?![+#])|\bc,\s*(?:java|python)/i },
  { slug: "r", re: /\b(?:python|sql|matlab),?\s+(?:and|or)?\s*r\b(?![a-z&])|\br\s*(?:,|and|or)\s*(?:python|sql)\b|\bin r\b(?![a-z])/i },
  { slug: "go", re: /\b(?:golang|go lang)\b|\bgo(?=\s*(?:,|\/|and|or)\s*(?:java|python|rust|c\+\+))|(?:java|python|rust|c\+\+),?\s+(?:and|or)?\s*go\b(?![a-z-])/i },
  { slug: "rest", re: /\brest(?:ful)?\s*(?:apis?|services?|endpoints?)\b|\brestful\b/i },
  { slug: "nodejs", re: /\bnode(?:\.js|js)?\b(?=\s*(?:,|\/|and|or|backend|server))|\bnode\.js\b|\bnodejs\b/i },
  { slug: "spark", re: /\b(?:apache\s+)?spark\b(?=.{0,40}(?:data|pyspark|hadoop|scala|etl|big data))|\bpyspark\b/i },
  { slug: "express", re: /\bexpress(?:\.js|js)\b|\bexpress\b(?=\s*(?:\(|framework|server|middleware|\/\s*node))|\bnode(?:\.js)?\s*(?:\/|and|,|with)\s*express\b/i },
  { slug: "spring", re: /\bspring\s*(?:boot|mvc|framework|cloud|data|security)\b|\bspringboot\b|\bjava\s*(?:\/|and|,)\s*spring\b/i },
  { slug: "excel", re: /\b(?:microsoft\s+)?excel\b(?!\s+(?:at|in|as|when)\b)(?=.{0,30}(?:spreadsheets?|formulas?|pivot|vba|,|\/))|\bms excel\b|\bmicrosoft excel\b/i },
  { slug: "observability", re: /\b(?:system|infrastructure|application|server|network|performance|uptime)\s+monitoring\b|\bmonitoring\s+(?:tools?|stack|dashboards?|metrics|alerts?|and\s+alerting)\b/i },
  { slug: "cybersecurity", re: /\binformation security\b(?!\s+(?:standards?|polic(?:y|ies)|training|awareness|requirements?|office|guidelines?))/i },
  { slug: "ml", re: /\bml\b(?=\s*(?:\/|models?|engineer|pipelines?|systems?|frameworks?|infrastructure|,\s*ai))|\bai\/ml\b|\bml\/ai\b/i },
];

/** Returns skill slugs found in free text, in taxonomy order. */
export function extractSkills(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const m of MATCHERS) if (!found.has(m.slug) && m.re.test(text)) found.add(m.slug);
  for (const m of CONTEXT_MATCHERS) if (!found.has(m.slug) && m.re.test(text)) found.add(m.slug);
  return SKILLS.filter((k) => found.has(k.slug)).map((k) => k.slug);
}

/** Map a free-form skill name (e.g. from a resume or user input) to a taxonomy slug. */
export function resolveSkill(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  const direct = SKILLS.find((k) => k.slug === n || k.aliases.includes(n));
  return direct?.slug ?? extractSkills(name)[0];
}
