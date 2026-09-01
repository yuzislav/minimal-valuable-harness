import { z } from 'zod';

export function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema) return z.any();

  switch (schema.type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.preprocess((val) => {
        if (typeof val === 'string' && val.trim() !== '') {
          const num = Number(val);
          if (!isNaN(num)) return num;
        }
        return val;
      }, z.number());
    case 'boolean':
      return z.preprocess((val) => {
        if (typeof val === 'string') {
          if (val.toLowerCase() === 'true') return true;
          if (val.toLowerCase() === 'false') return false;
        }
        return val;
      }, z.boolean());
    case 'array':
      return z.preprocess((val) => {
        if (typeof val === 'string') {
          try { return JSON.parse(val); } catch {}
        }
        return val;
      }, z.array(jsonSchemaToZod(schema.items)));
    case 'object':
      const parseObj = (val: any) => {
        if (typeof val === 'string') {
          try { return JSON.parse(val); } catch {}
        }
        return val;
      };
      if (schema.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, prop] of Object.entries(schema.properties)) {
          let propSchema = jsonSchemaToZod(prop);
          if (!schema.required || !schema.required.includes(key)) {
            propSchema = propSchema.optional();
          }
          shape[key] = propSchema;
        }
        return z.preprocess(parseObj, z.object(shape));
      }
      return z.preprocess(parseObj, z.record(z.any()));
    default:
      return z.any();
  }
}
