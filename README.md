# graphql-codegen-node

usage: node cli.js --config ./path/to/graphql.config.json

## example config file

This file can contain any number of clients within the outer array

```
[{
    "name": "ExampleClient",
    "schema": "http://localhost:4001/graphql",
    "options": {
        "headers": {

        }
    },
    "output": "../relative/path/where/output/should/be/written/example_client.js",
    "config": {

        "local": {
            "endpoint": "http://local-server-host.example.com/graphql",
            "options": {
                "headers": {
                    "Authorization": "<endpoint auth key>"
                }
            }
        },

        "dev": {
            "endpoint": "http://dev-server-host.example.com/graphql",
            "options": {
                "headers": {
                    "Authorization": "<endpoint auth key>"
                }
            }
        },

        "production": {
            "endpoint": "http://prod-server-host.example.com/graphql",
            "options": {
                "headers": {
                    "Authorization": "<endpoint auth key>"
                }
            }
        }
    }
}]
```