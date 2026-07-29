import { syncCustomerDirectoryBounded as runDirectorySync } from "./_customer-entra-bounded-sync.js";

const INVALID_CUSTOMER_VALUES = "VALUES (?,?,?,?,?,NULL,?,'clear',?,?,?,?,?)";
const CORRECT_CUSTOMER_VALUES = "VALUES (?,?,?,?,?,NULL,?,'clear',?,?,?,?)";
const CORRECT_CUSTOMER_BIND_COUNT = 10;

function bindMethod(target) {
  return (property, receiver) => {
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  };
}

function correctedStatement(statement) {
  return new Proxy(statement, {
    get(target, property, receiver) {
      if (property === "bind") {
        return (...values) => target.bind(...values.slice(0, CORRECT_CUSTOMER_BIND_COUNT));
      }
      return bindMethod(target)(property, receiver);
    }
  });
}

function correctedDatabase(database) {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return sql => {
          const source = String(sql);
          if (!source.includes(INVALID_CUSTOMER_VALUES)) return target.prepare(source);
          return correctedStatement(target.prepare(source.replace(INVALID_CUSTOMER_VALUES, CORRECT_CUSTOMER_VALUES)));
        };
      }
      return bindMethod(target)(property, receiver);
    }
  });
}

export async function syncCustomerDirectory(env, requestedMode, startedBy) {
  const database = correctedDatabase(env.DB);
  const correctedEnvironment = new Proxy(env, {
    get(target, property, receiver) {
      if (property === "DB") return database;
      return Reflect.get(target, property, receiver);
    }
  });
  return runDirectorySync(correctedEnvironment, requestedMode, startedBy);
}
