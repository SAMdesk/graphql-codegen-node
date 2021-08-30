'use strict';

const fs = require('fs');
const path = require('path');
const { request } = require('graphql-request');

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

function generate_function_docs(fn, types_map) {

  let output = '';

  output += `${tabs(1)}/**\n`;

  output += fn.args.map((arg) => {
    return generate_function_param_doc(arg.name, arg.type, arg.defaultValue, false, false, types_map);
  }).join('');

  output += `${tabs(1)} * @param {function} done\n`;
  output += `${tabs(1)} */\n`;

  return output;

}

function generate_helpers(c) {
    let output = "";
    output += "\n";

    // Create the key Getter first
    output +=  `${tabs(1)}getClientKey(force=null) {\n`;
    output += `${tabs(2)}return new Promise((resolve, reject) => {\n`;
    output += `${tabs(3)}let now = Date.now();\n`;
    output += `${tabs(3)}if (${c.name}.auth_key === null || (now - ${c.name}.last_fetched_date.getTime())/60000 >= 5 || force) {\n`;
    output += `${tabs(4)}${c.name}.GraphQlClient.find({application:${c.name}.application}).sort("-created").lean().exec((err, clients)=> {\n`;
    output += `${tabs(5)}if (err || !clients.length){\n`;
    output += `${tabs(6)}reject(err || 'There are no clients for this application');\n`;
    output +=`${tabs(5)}}\n`;
    output += `${tabs(5)}let client = clients[0];\n`;
    output += `${tabs(5)}${c.name}.auth_key = client.key;\n`;
    output += `${tabs(5)}${c.name}.last_fetched_date = new Date(now);\n`;
    output += `${tabs(5)}this.options.headers = {Authorization: ${c.name}.auth_key, person: JSON.stringify({name:this.person.name, _id: this.person._id})};\n`;
    output += `${tabs(5)}this.client = new GraphQLClient(${c.name}.endpoint, this.options);\n`;
    output += `${tabs(5)}resolve();\n`;
    output += `${tabs(4)}});\n`;
    output += `${tabs(3)}} else {\n`;
    output += `${tabs(4)}this.options.headers = {Authorization: ${c.name}.auth_key, person: JSON.stringify({name:this.person.name, _id: this.person._id})};\n`;
    output += `${tabs(4)}this.client = new GraphQLClient(${c.name}.endpoint, this.options);\n`;
    output += `${tabs(4)}resolve();\n`;
    output += `${tabs(3)}}\n`;
    output += `${tabs(2)}});\n`;
    output += `${tabs(1)}}\n`;
    output += `\n`;

    output +=  `${tabs(1)}RetryRequest(query, params, err, done) {\n`;
    output +=  `${tabs(2)}let current_key = ${c.name}.auth_key;\n`;
    output += `${tabs(2)}this.getClientKey(true)\n`;
    output += `${tabs(3)}.then(() => {\n`;
    output += `${tabs(4)}if (current_key !== ${c.name}.auth_key) {\n`;
    output += `${tabs(5)}return this.client.request(query, params);\n`;
    output += `${tabs(4)}} else {\n`;
    output += `${tabs(5)}done(err, null);\n`;
    output += `${tabs(4)}}\n`;
    output += `${tabs(3)}})\n`;
    output += `${tabs(3)}.then((response) => {\n`;
    output += `${tabs(4)}done(null,response);\n`;
    output += `${tabs(3)}});\n`;
    output += `${tabs(2)}}\n`;
    output += `\n`;

    return output;

}

function generate_function_param_doc(name, type_obj, default_value, is_list, is_non_null, types_map) {

  let type_name = null;
  switch(type_obj.kind) {
    case 'NON_NULL':
      return generate_function_param_doc(name, type_obj.ofType, default_value, is_list, true, types_map);
    case 'LIST':
      return generate_function_param_doc(name, type_obj.ofType, default_value, true, is_non_null, types_map);
    case 'OBJECT':
    case 'INPUT_OBJECT':
      type_name = 'object';
      break;
    default:
      type_name = {
        'ID': 'string',
        'Int': 'number',
        'Float': 'number',
        'String': 'string',
        'Boolean': 'boolean'
      }[type_obj.name];
      break;
    }

    let output = '';
    output += `${tabs(1)} * @param {${type_name}} `;
    if(!is_non_null) output += `[`;
    output += name;
    if(default_value !== null) output += `=${default_value}`;
    if(!is_non_null) output += `]`;
    output += `\n`;

    if(type_name === 'object') {
      const type = types_map[type_obj.name];
      output += type.inputFields.map((field) => {
        let field_name = name;
        if(is_list) field_name += `[]`;
        field_name += `.${field.name}`;
        return generate_function_param_doc(field_name, field.type, field.defaultValue, false, false, types_map);
      }).join('');
    }

    return output;

}

function generate_function(fn, fn_type, types_map) {

    let output = '';

    output += generate_function_docs(fn, types_map);

    let param_list = [];
    const function_params = fn.args.map((arg) => {
        param_list.push(arg.name);
        return arg.name;
    }).concat(['done']).join(', ');

    const outer_query_params = fn.args.map((arg) => {
        return `$${arg.name}: ${get_type_string(arg.type)}`;
    }).join(', ');

    const inner_query_params = fn.args.map((arg) => {
        return `${arg.name}: $${arg.name}`;
    }).join(', ');

    output += `${tabs(1)}${fn.name}(${function_params}) {\n`;
    output += `${tabs(2)}let query = \`\n`;
    output += `${tabs(3)}${fn_type} ${fn.name}(${outer_query_params}) {\n`;
    output += `${tabs(4)}${fn.name}(${inner_query_params})`;

    const return_type = types_map[get_object_type(fn.type)];
    if(return_type.kind === 'OBJECT') {
        output += ` {\n`;
        output += generate_fields(return_type.fields, 5, types_map);
        output += `${tabs(4)}}\n`;
    } else {
        output += `\n`;
    }

    output += `${tabs(3)}}\n`;
    output += `${tabs(2)}\`;\n`;

    output += `${tabs(2)}let parameters = {\n`;
    param_list.forEach((param,index)=> {
        if (index + 1 !== param_list.length){
            output += `${tabs(3)}${param}:${param},\n`;
        } else {
            output += `${tabs(3)}${param}:${param}\n`;
        }
    });
    output += `${tabs(2)}};\n`;
    output += `${tabs(2)}this.getClientKey().then(() => {\n`;
    output += `${tabs(3)}return this.client.request(query, parameters);\n`;
    output += `${tabs(2)}}).then((response) => {\n`;
    output += `${tabs(3)}done(null, response.${fn.name});\n`;
    output += `${tabs(2)}}, (err) => {\n`;
    output += `${tabs(3)}if (err.response && err.response.status === 401) {\n`;
    output += `${tabs(4)}this.RetryRequest(query, parameters, err, (error, response) => {\n`;
    output += `${tabs(5)}if (error === null && response === undefined) {\n`;
    output += `${tabs(6)}done(new Error("Something went wrong"));\n`;
    output += `${tabs(5)}} else if (error) {\n`;
    output += `${tabs(6)}done(error);\n`;
    output += `${tabs(5)}} else {\n`;
    output += `${tabs(6)}done(error, response.${fn.name});\n`;
    output += `${tabs(5)}}\n`;
    output += `${tabs(4)}});\n`;
    output += `${tabs(3)}} else {\n`;
    output += `${tabs(4)}done(err);\n`;
    output += `${tabs(3)}}\n`;
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

module.exports = function(config, base_path) {

  if(!base_path) base_path = process.cwd();

  return Promise.all(config.map((c) => {

      return request(c.schema, introspection_query).then((data) => {

          let output = '';

          output += `'use strict';\n\n`;
          output += `const _ = require('lodash');\n`;
          output += `const GraphQLClient = require('../../common/sam_graphql_client');\n`;
          output += `\n`;
          output += `module.exports = class ${c.name} {\n`;
          output += `\n`;

          output += `${tabs(1)}constructor(person) {\n`;
          output += `${tabs(2)}this.options={};\n`;
          output += `${tabs(2)}this.person = {name: person.name, _id:person._id};\n`;
          output += `${tabs(2)}this.client = null;\n`;
          output += `${tabs(1)}}\n`;
          output += `\n`;
          output += `${tabs(1)}static init(endpoint, options, locator, app_name) {\n`;
          output += `${tabs(2)}${c.name}.endpoint = endpoint;\n`;
          output += `${tabs(2)}${c.name}.options = options;\n`;
          output += `${tabs(2)}${c.name}.locator = locator;\n`;
          output += `${tabs(2)}${c.name}.application = app_name;\n`;
          output += `${tabs(2)}${c.name}.mongoose = ${c.name}.locator.get('mongoose');\n`;
          output += `${tabs(2)}${c.name}.GraphQlClient = ${c.name}.mongoose.model('GraphQlClient');\n`;
          output += `${tabs(2)}${c.name}.last_fetched_date = new Date();\n`;
          output += `${tabs(2)}${c.name}.auth_key = null;\n`;
          output += `${tabs(1)}}\n`;
          output += `\n`;

          const types_map = {};
          data.__schema.types.forEach((type) => {
              types_map[type.name] = type;
          });

          output += generate_helpers(c);

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
              const file_path = path.resolve(base_path, c.output);
              mkdirs(file_path);
              fs.writeFileSync(file_path, output);

              console.log(`Done - file written to ${file_path}`);

              return Promise.resolve();
          } catch(ex) {
              return Promise.reject(ex);
          }

      }, (e) => {
          console.log("Error requesting endpoint metadata. Details: ", JSON.stringify(e.response));
          Promise.reject(e);
      });

  }));

};