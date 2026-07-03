const assert = require('assert');

// Replicate the TYPES data from the tool
const TYPES = [
  { name: 'Partial<T>', cat: 'Object', ts: '2.1', desc: 'Constructs a type with all properties of T set to optional. Useful for update payloads where not every field is required.', syntax: 'type Partial<T> = { [P in keyof T]?: T[P]; }', example: 'interface User { id: number; name: string; email: string; }\n\ntype UserUpdate = Partial<User>;\n// { id?: number; name?: string; email?: string; }\n\nfunction updateUser(id: number, changes: Partial<User>) { /* ... */ }' },
  { name: 'Required<T>', cat: 'Object', ts: '2.8', desc: 'Constructs a type with all properties of T set to required, removing optional modifiers. Opposite of Partial.', syntax: 'type Required<T> = { [P in keyof T]-?: T[P]; }', example: 'interface Config { host?: string; port?: number; debug?: boolean; }\n\ntype StrictConfig = Required<Config>;\n// { host: string; port: number; debug: boolean; }\n\nfunction init(cfg: Required<Config>) { /* ... */ }' },
  { name: 'Readonly<T>', cat: 'Object', ts: '2.1', desc: 'Constructs a type with all properties of T set to readonly, preventing reassignment after creation.', syntax: 'type Readonly<T> = { readonly [P in keyof T]: T[P]; }', example: 'interface Point { x: number; y: number; }\n\nconst origin: Readonly<Point> = { x: 0, y: 0 };\n// origin.x = 1; // Error: cannot assign to \'x\'\n\nconst DEFAULTS = Object.freeze({ color: \'blue\', size: 12 });\ntype Defaults = Readonly<typeof DEFAULTS>;' },
  { name: 'Record<K, V>', cat: 'Object', ts: '2.1', desc: 'Constructs an object type with keys of type K and values of type V. Cleaner than index signatures for known key sets.', syntax: 'type Record<K extends keyof any, V> = { [P in K]: V; }', example: "type Role = 'admin' | 'editor' | 'viewer';\ntype Permissions = Record<Role, string[]>;\n\nconst perms: Permissions = {\n  admin: ['read', 'write', 'delete'],\n  editor: ['read', 'write'],\n  viewer: ['read'],\n};\n\ntype PageMap = Record<string, { title: string; url: string }>;" },
  { name: 'Pick<T, K>', cat: 'Object', ts: '2.1', desc: 'Constructs a type by picking the set of properties K from T. Creates a subset type without the unwanted fields.', syntax: 'type Pick<T, K extends keyof T> = { [P in K]: T[P]; }', example: 'interface Article {\n  id: number; title: string;\n  body: string; authorId: number; createdAt: Date;\n}\n\ntype ArticlePreview = Pick<Article, \'id\' | \'title\' | \'createdAt\'>;\n// { id: number; title: string; createdAt: Date; }\n\nfunction getPreview(a: Article): ArticlePreview {\n  return { id: a.id, title: a.title, createdAt: a.createdAt };\n}' },
  { name: 'Omit<T, K>', cat: 'Object', ts: '3.5', desc: "Constructs a type by picking all properties from T then removing K. The inverse of Pick — exclude what you don't want.", syntax: 'type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>', example: "interface Post {\n  id: number; title: string;\n  body: string; authorId: number; createdAt: Date;\n}\n\ntype NewPost = Omit<Post, 'id' | 'createdAt'>;\n// { title: string; body: string; authorId: number; }\n\ntype PublicUser = Omit<User, 'passwordHash' | 'salt'>;" },
  { name: 'Exclude<T, U>', cat: 'Union', ts: '2.8', desc: 'Constructs a type by excluding from union type T all members assignable to U. Narrows union types by removing unwanted variants.', syntax: 'type Exclude<T, U> = T extends U ? never : T', example: "type Status = 'active' | 'inactive' | 'banned' | 'pending';\ntype AllowedStatus = Exclude<Status, 'banned'>;\n// 'active' | 'inactive' | 'pending'\n\ntype NonString = Exclude<string | number | boolean, string>;\n// number | boolean\n\ntype NoNull<T> = Exclude<T, null | undefined>;" },
  { name: 'Extract<T, U>', cat: 'Union', ts: '2.8', desc: 'Constructs a type by extracting from union type T all members assignable to U. Opposite of Exclude — keeps only matching variants.', syntax: 'type Extract<T, U> = T extends U ? T : never', example: "type Shape = 'circle' | 'square' | 'triangle' | 'rectangle';\ntype Quad = Extract<Shape, 'square' | 'rectangle'>;\n// 'square' | 'rectangle'\n\ntype StringOrNumber = Extract<string | number | boolean | null, string | number>;\n// string | number\n\ntype ClickEvent = Extract<Event, MouseEvent | PointerEvent>;" },
  { name: 'NonNullable<T>', cat: 'Union', ts: '2.8', desc: 'Constructs a type by removing null and undefined from T. Useful for narrowing types after null checks.', syntax: 'type NonNullable<T> = T & {}', example: "type MaybeString = string | null | undefined;\ntype DefiniteString = NonNullable<MaybeString>;\n// string\n\nfunction process<T>(value: T): NonNullable<T> {\n  if (value == null) throw new Error('unexpected null');\n  return value as NonNullable<T>;\n}\n\ntype Clean<T> = { [K in keyof T]: NonNullable<T[K]> };" },
  { name: 'ReturnType<T>', cat: 'Function', ts: '2.8', desc: 'Constructs a type consisting of the return type of function type T. Useful for deriving types from factory functions.', syntax: 'type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any', example: "function createUser() {\n  return { id: 1, name: 'Alice', role: 'admin' as const };\n}\n\ntype User = ReturnType<typeof createUser>;\n// { id: number; name: string; role: \"admin\" }\n\nconst result = someApiCall();\ntype ApiResult = ReturnType<typeof someApiCall>;" },
  { name: 'Parameters<T>', cat: 'Function', ts: '3.1', desc: 'Constructs a tuple type from the parameter types of a function type T. Useful for wrapping or proxying functions.', syntax: 'type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never', example: "function createPost(title: string, body: string, tags: string[]) { /* ... */ }\n\ntype PostArgs = Parameters<typeof createPost>;\n// [title: string, body: string, tags: string[]]\n\nfunction wrapFn<T extends (...args: any[]) => any>(\n  fn: T,\n  ...args: Parameters<T>\n): ReturnType<T> {\n  return fn(...args);\n}" },
  { name: 'ConstructorParameters<T>', cat: 'Function', ts: '3.1', desc: 'Constructs a tuple type from the parameter types of a constructor function type T.', syntax: 'type ConstructorParameters<T extends abstract new (...args: any) => any> = T extends abstract new (...args: infer P) => any ? P : never', example: "class Database {\n  constructor(host: string, port: number, db: string) {}\n}\n\ntype DbArgs = ConstructorParameters<typeof Database>;\n// [host: string, port: number, db: string]\n\nfunction createInstance<T extends new (...args: any[]) => any>(\n  cls: T,\n  ...args: ConstructorParameters<T>\n): InstanceType<T> {\n  return new cls(...args);\n}" },
  { name: 'InstanceType<T>', cat: 'Function', ts: '2.8', desc: 'Constructs a type consisting of the instance type of a constructor function type T. Works with class constructors.', syntax: 'type InstanceType<T extends abstract new (...args: any) => any> = T extends abstract new (...args: any) => infer R ? R : any', example: "class HttpClient {\n  get(url: string) { return fetch(url); }\n  post(url: string, body: unknown) { return fetch(url, { method: 'POST' }); }\n}\n\ntype Client = InstanceType<typeof HttpClient>;\n// HttpClient\n\nfunction useClient(c: InstanceType<typeof HttpClient>) { /* ... */ }\n\ntype AnyInstance<T extends new (...a: any[]) => any> = InstanceType<T>;" },
  { name: 'Awaited<T>', cat: 'Async', ts: '4.5', desc: 'Recursively unwraps the type wrapped in Promise<> or thenable objects. Handles deeply nested promises.', syntax: 'type Awaited<T> = T extends null | undefined ? T : T extends object & { then(onfulfilled: infer F, ...args: infer _): any; } ? F extends ((value: infer V, ...args: infer _) => any) ? Awaited<V> : never : T', example: "type A = Awaited<Promise<string>>;           // string\ntype B = Awaited<Promise<Promise<number>>>;  // number\ntype C = Awaited<string>;                    // string (passthrough)\n\nasync function fetchUser(): Promise<User> { /* ... */ }\ntype FetchedUser = Awaited<ReturnType<typeof fetchUser>>;\n// User\n\ntype DeepUnwrap<T> = Awaited<T>;" },
  { name: 'ThisParameterType<T>', cat: 'Function', ts: '3.3', desc: 'Extracts the type of the this parameter for a function type, or unknown if the function type has no this parameter.', syntax: 'type ThisParameterType<T> = T extends (this: infer U, ...args: never) => any ? U : unknown', example: "function greet(this: { name: string }, greeting: string) {\n  return `${greeting}, ${this.name}!`;\n}\n\ntype Context = ThisParameterType<typeof greet>;\n// { name: string }\n\ninterface Describable { description: string; }\nfunction describe(this: Describable) { return this.description; }\ntype DescContext = ThisParameterType<typeof describe>; // Describable" },
  { name: 'OmitThisParameter<T>', cat: 'Function', ts: '3.3', desc: 'Removes the this parameter from a function type T. Useful when you bind a function and want to reflect the type change.', syntax: "type OmitThisParameter<T> = unknown extends ThisParameterType<T> ? T : T extends (...args: infer A) => infer R ? (...args: A) => R : T", example: "function formatName(this: { locale: string }, name: string) {\n  return name.toLocaleLowerCase(this.locale);\n}\n\ntype Formatter = OmitThisParameter<typeof formatName>;\n// (name: string) => string\n\nconst bound = formatName.bind({ locale: 'en-US' });\n// bound: OmitThisParameter<typeof formatName>" },
  { name: 'ThisType<T>', cat: 'Function', ts: '2.3', desc: 'Marker type that designates the type of this inside method definitions in object literals. Requires --noImplicitThis.', syntax: 'interface ThisType<T> { }  // marker, no members', example: "interface State { count: number; label: string; }\ninterface Methods {\n  increment(): void;\n  reset(): void;\n}\n\ntype Component = State & ThisType<State & Methods>;\n\nconst comp: Component & Methods = {\n  count: 0, label: 'counter',\n  increment() { this.count++; },   // this: State & Methods\n  reset() { this.count = 0; },\n};" },
  { name: 'NoInfer<T>', cat: 'Object', ts: '5.4', desc: 'Blocks TypeScript from using a type position as an inference site. Forces callers to specify a type or use another site for inference.', syntax: 'type NoInfer<T> = intrinsic', example: "// Without NoInfer — 'default' widens the inferred type\nfunction createStore<T>(initial: T, fallback: T): T { return initial ?? fallback; }\ncreateStore(42, \"string\"); // Error only if T already inferred\n\n// With NoInfer — fallback cannot influence T inference\nfunction createStore2<T>(initial: T, fallback: NoInfer<T>): T {\n  return initial ?? fallback;\n}\ncreateStore2(42, \"string\"); // Error: string not assignable to number" },
  { name: 'Uppercase<S>', cat: 'String', ts: '4.1', desc: 'Converts each character in a string literal type to its uppercase equivalent. Intrinsic — implemented in the compiler.', syntax: 'type Uppercase<S extends string> = intrinsic', example: "type Greeting = Uppercase<'hello world'>;\n// 'HELLO WORLD'\n\ntype EventName = 'click' | 'focus' | 'blur';\ntype EventConst = Uppercase<EventName>;\n// 'CLICK' | 'FOCUS' | 'BLUR'\n\ntype EnvKey<K extends string> = `VITE_${Uppercase<K>}`;\ntype Key = EnvKey<'apiUrl'>; // 'VITE_APIURL'" },
  { name: 'Lowercase<S>', cat: 'String', ts: '4.1', desc: 'Converts each character in a string literal type to its lowercase equivalent.', syntax: 'type Lowercase<S extends string> = intrinsic', example: "type Shout = 'HELLO' | 'WORLD';\ntype Quiet = Lowercase<Shout>;\n// 'hello' | 'world'\n\ntype HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';\ntype LowerMethod = Lowercase<HttpMethod>;\n// 'get' | 'post' | 'put' | 'delete'\n\ntype CssVar<K extends string> = `--${Lowercase<K>}`;" },
  { name: 'Capitalize<S>', cat: 'String', ts: '4.1', desc: 'Converts the first character in a string literal type to uppercase. Useful for building getter/setter or camelCase names.', syntax: 'type Capitalize<S extends string> = intrinsic', example: "type Name = Capitalize<'firstName'>;\n// 'FirstName'\n\ntype Getter<K extends string> = `get${Capitalize<K>}`;\ntype GetName = Getter<'name'>; // 'getName'\ntype GetAge = Getter<'age'>;   // 'getAge'\n\ntype Keys = 'id' | 'name' | 'createdAt';\ntype Caps = Capitalize<Keys>; // 'Id' | 'Name' | 'CreatedAt'" },
  { name: 'Uncapitalize<S>', cat: 'String', ts: '4.1', desc: 'Converts the first character in a string literal type to lowercase.', syntax: 'type Uncapitalize<S extends string> = intrinsic', example: "type PascalKey = 'UserName' | 'CreatedAt';\ntype CamelKey = Uncapitalize<PascalKey>;\n// 'userName' | 'createdAt'\n\ntype PropKey<K extends string> = Uncapitalize<K>;\ntype Event = Uncapitalize<'Click' | 'Focus'>; // 'click' | 'focus'\n\n// Undo accidental Capitalize\ntype Back = Uncapitalize<Capitalize<'hello'>>; // 'hello'" },
];

let passed = 0;
function test(desc, fn) {
  try { fn(); passed++; console.log(`  ✓ ${desc}`); }
  catch(e) { console.error(`  ✗ ${desc}: ${e.message}`); process.exit(1); }
}

// --- Structure tests ---
console.log('\n[1] Array structure');
test('TYPES is an array', () => assert(Array.isArray(TYPES)));
test('Contains exactly 22 utility types', () => assert.strictEqual(TYPES.length, 22));

console.log('\n[2] Required fields on every entry');
TYPES.forEach((t, i) => {
  test(`[${i}] ${t.name} has name`, () => assert(typeof t.name === 'string' && t.name.length > 0));
  test(`[${i}] ${t.name} has cat`, () => assert(typeof t.cat === 'string' && t.cat.length > 0));
  test(`[${i}] ${t.name} has ts version`, () => assert(typeof t.ts === 'string' && t.ts.length > 0));
  test(`[${i}] ${t.name} has desc`, () => assert(typeof t.desc === 'string' && t.desc.length > 10));
  test(`[${i}] ${t.name} has syntax`, () => assert(typeof t.syntax === 'string' && t.syntax.length > 0));
  test(`[${i}] ${t.name} has example`, () => assert(typeof t.example === 'string' && t.example.length > 0));
});

console.log('\n[3] Category validation');
const VALID_CATS = ['Object', 'Union', 'Function', 'String', 'Async'];
TYPES.forEach(t => {
  test(`${t.name} has valid category "${t.cat}"`, () => assert(VALID_CATS.includes(t.cat)));
});

console.log('\n[4] TS version format');
TYPES.forEach(t => {
  test(`${t.name} ts version is valid semver-like`, () => assert(/^\d+\.\d+$/.test(t.ts)));
});

console.log('\n[5] No duplicate names');
const names = TYPES.map(t => t.name);
test('All names are unique', () => assert.strictEqual(new Set(names).size, names.length));

console.log('\n[6] Specific types present');
const typeNames = new Set(names);
const required = ['Partial<T>', 'Required<T>', 'Readonly<T>', 'Record<K, V>', 'Pick<T, K>', 'Omit<T, K>', 'Exclude<T, U>', 'Extract<T, U>', 'NonNullable<T>', 'ReturnType<T>', 'Parameters<T>', 'ConstructorParameters<T>', 'InstanceType<T>', 'Awaited<T>', 'ThisParameterType<T>', 'OmitThisParameter<T>', 'ThisType<T>', 'NoInfer<T>', 'Uppercase<S>', 'Lowercase<S>', 'Capitalize<S>', 'Uncapitalize<S>'];
required.forEach(name => {
  test(`Contains "${name}"`, () => assert(typeNames.has(name)));
});

console.log('\n[7] Category counts');
const byCat = {};
TYPES.forEach(t => { byCat[t.cat] = (byCat[t.cat] || 0) + 1; });
test('Object category has at least 4 types', () => assert(byCat['Object'] >= 4));
test('Union category has at least 3 types', () => assert(byCat['Union'] >= 3));
test('Function category has at least 4 types', () => assert(byCat['Function'] >= 4));
test('String category has exactly 4 types', () => assert.strictEqual(byCat['String'], 4));
test('Async category has at least 1 type', () => assert(byCat['Async'] >= 1));

console.log('\n[8] Description quality');
TYPES.forEach(t => {
  test(`${t.name} desc is at least 30 chars`, () => assert(t.desc.length >= 30));
  test(`${t.name} desc does not start with whitespace`, () => assert(t.desc[0] !== ' '));
});

console.log('\n[9] Syntax contains type name keyword');
test('Partial syntax references Partial', () => assert(TYPES.find(t=>t.name==='Partial<T>').syntax.includes('Partial')));
test('Required syntax references Required', () => assert(TYPES.find(t=>t.name==='Required<T>').syntax.includes('Required')));
test('Readonly syntax references readonly', () => assert(TYPES.find(t=>t.name==='Readonly<T>').syntax.includes('readonly')));
test('Record syntax references Record', () => assert(TYPES.find(t=>t.name==='Record<K, V>').syntax.includes('Record')));

console.log('\n[10] TS version ordering sanity');
const tsVersionToNum = v => parseFloat(v);
const objTypes = TYPES.filter(t => t.cat === 'Object');
test('Partial ts version >= 2.0', () => assert(tsVersionToNum(TYPES.find(t=>t.name==='Partial<T>').ts) >= 2.0));
test('NoInfer ts version >= 5.0', () => assert(tsVersionToNum(TYPES.find(t=>t.name==='NoInfer<T>').ts) >= 5.0));
test('Awaited ts version >= 4.0', () => assert(tsVersionToNum(TYPES.find(t=>t.name==='Awaited<T>').ts) >= 4.0));
test('String types added in 4.1+', () => {
  TYPES.filter(t => t.cat === 'String').forEach(t => assert(tsVersionToNum(t.ts) >= 4.1));
});

console.log(`\n✅ All ${passed} tests passed\n`);
