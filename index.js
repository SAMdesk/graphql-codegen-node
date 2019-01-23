#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { request } = require('graphql-request');

const argv = require('minimist')(process.argv.slice(2));

if(!argv.config) {
    console.error('Missing required parameter: --config');
    process.exit(1);
}

const introspection_query = `
    query IntrospectionQuery {
      __schema {
        queryType { name }
        mutationType { name }
        subscriptionType { name }
        types {
          ...FullType
        }
        directives {
          name
          locations
          args {
            ...InputValue
          }
        }
      }
    }
    fragment FullType on __Type {
      kind
      name
      fields(includeDeprecated: true) {
        name
        args {
          ...InputValue
        }
        type {
          ...TypeRef
        }
        isDeprecated
        deprecationReason
      }
      inputFields {
        ...InputValue
      }
      interfaces {
        ...TypeRef
      }
      enumValues(includeDeprecated: true) {
        name
        isDeprecated
        deprecationReason
      }
      possibleTypes {
        ...TypeRef
      }
    }
    fragment InputValue on __InputValue {
      name
      type { ...TypeRef }
      defaultValue
    }
    fragment TypeRef on __Type {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
`;

function tabs(n) {
    let s = '';
    for(let i = 0; i < n; i++) s += '\t';
    return s;
}

function get_type_string(type) {
    switch(type.kind) {
        case 'NON_NULL':
            return `${get_type_string(type.ofType)}!`;
        case 'LIST':
            return `[${get_type_string(type.ofType)}]`;
        default:
            return type.name;
    }
}

function get_object_type(type) {
    switch(type.kind) {
        case 'NON_NULL':
        case 'LIST':
            return get_object_type(type.ofType);
        default:
            return type.name;
    }
}

function get_object_kind(type) {
    switch(type.kind) {
        case 'NON_NULL':
        case 'LIST':
            return get_object_kind(type.ofType);
        default:
            return type.kind;
    }
}

function generate_function(fn, fn_type, types_map) {

    let output = '';

    const function_params = fn.args.map((arg) => {
        return arg.name;
    }).join(', ');

    const outer_query_params = fn.args.map((arg) => {
        return `$${arg.name}: ${get_type_string(arg.type)}`;
    }).join(', ');

    const inner_query_params = fn.args.map((arg) => {
        return `${arg.name}: $${arg.name}`;
    }).join(', ');

    output += `${tabs(1)}${fn.name}(${function_params}) {\n`;
    output += `${tabs(2)}return this.client.request(\`\n`;
    output += `${tabs(3)}${fn_type} ${fn.name}(${outer_query_params}) {\n`;
    output += `${tabs(4)}${fn.name}(${inner_query_params}) {\n`;

    const return_type = types_map[get_object_type(fn.type)];
    output += generate_fields(return_type.fields, 5, types_map);

    output += `${tabs(4)}}\n`;
    output += `${tabs(3)}}\n`;
    output += `${tabs(2)}\`, {\n`;

    fn.args.forEach((arg, i) => {
        output += `${tabs(3)}${arg.name}: ${arg.name}${i < (fn.args.length - 1) ? ',' : ''}\n`;
    });

    output += `${tabs(2)}});\n`;
    output += `${tabs(1)}}\n`;
    output += `\n`;

    return output;

}

function generate_fields(fields, indent, types_map) {

    let output = '';

    fields.forEach((field) => {
        const kind = get_object_kind(field.type);
        switch(kind) {
            case 'OBJECT':
                const type = types_map[get_object_type(field.type)];
                output += `${tabs(indent)}${field.name} {\n`;
                output += generate_fields(type.fields, indent + 1, types_map);
                output += `${tabs(indent)}}\n`;
                break;
            default:
                output += `${tabs(indent)}${field.name}\n`;
                break;
        }

    });

    return output;

}

function mkdirs(file_path) {
    const dirname = path.dirname(file_path);
    if (fs.existsSync(dirname)) return true;
    mkdirs(dirname);
    fs.mkdirSync(dirname);
}

const config_path = path.resolve(__dirname, argv.config);
const config = require(config_path);
Promise.all(config.map((c) => {

    return request(c.schema, introspection_query).then((data) => {

        let output = '';

        output += `const { GraphQLClient } = require('graphql-request');\n`;
        output += `\n`;
        output += `module.exports = class ${c.name} {\n`;
        output += `\n`;

        output += `${tabs(1)}constructor(endpoint, options) {\n`;
        output += `${tabs(2)}this.client = new GraphQLClient(endpoint, options);\n`;
        output += `${tabs(1)}}\n`;
        output += `\n`;

        const types_map = {};
        data.__schema.types.forEach((type) => {
            types_map[type.name] = type;
        });

        if(data.__schema.queryType) {
            const query_type = types_map[data.__schema.queryType.name];
            query_type.fields.forEach((fn) => {
                output += generate_function(fn, 'query', types_map);
            });
        }

        if(data.__schema.mutationType) {
            const mutation_type = types_map[data.__schema.mutationType.name];
            mutation_type.fields.forEach((fn) => {
                output += generate_function(fn, 'mutation', types_map);
            });
        }

        output += `};`;

        try {
            const file_path = path.resolve(path.dirname(config_path), c.output);
            mkdirs(file_path);
            fs.writeFileSync(file_path, output);
            return Promise.resolve();
        } catch(ex) {
            return Promise.reject(ex);
        }

    });

})).then(() => {
    process.exit(0);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});