#include "spindata.h"
#include "rpc_json.h"

spin_data jsonrpc_blockflow(spin_data arg) {

    return arg;
}

struct funclist {
    const char * rpc_name;
    rpcfunc      rpc_func;
} funclist[] = {
    { "get_blockflow",    jsonrpc_blockflow },
    { 0, 0}
};

static spin_data
make_answer(spin_data id) {
    spin_data retobj;

    retobj = cJSON_CreateObject();
    cJSON_AddStringToObject(retobj, "jsonrpc", "2.0");
    cJSON_AddItemReferenceToObject(retobj, "id", id);
    return retobj;
}

static spin_data
json_error(spin_data call_info, int errorno) {
    spin_data errorobj;
    spin_data idobj;

    idobj = cJSON_GetObjectItemCaseSensitive(call_info, "id");
    errorobj = make_answer(idobj);
    // This should not be present I think
    // cJSON_AddNullToObject(errorobj, "result");
    cJSON_AddNumberToObject(errorobj, "error", errorno);
    return errorobj;
}

spin_data rpc_json(spin_data call_info) {
    spin_data jsonrpc;
    spin_data jsonid;
    spin_data jsonmethod;
    spin_data jsonparams;
    char *method;
    struct funclist *p;
    spin_data jsonretval;
    spin_data jsonanswer;

    jsonrpc = cJSON_GetObjectItemCaseSensitive(call_info, "jsonrpc");
    if (!cJSON_IsString(jsonrpc) || strcmp(jsonrpc->valuestring, "2.0")) {
        return json_error(call_info, 1);
    }

    // Get id, if not there it is a Notification
    jsonid = cJSON_GetObjectItemCaseSensitive(call_info, "id");

    jsonmethod = cJSON_GetObjectItemCaseSensitive(call_info, "method");
    if (!cJSON_IsString(jsonmethod)) {
        return json_error(call_info, 1);
    }
    method = jsonmethod->valuestring;

    jsonparams = cJSON_GetObjectItemCaseSensitive(call_info, "params");

    for (p=funclist; p->rpc_name; p++) {
        if (strcmp(p->rpc_name, method) == 0) {
            break;
        }
    }

    if (p->rpc_name == 0) {
        return json_error(call_info, 1);
    }

    jsonretval = (*p->rpc_func)(jsonparams);

    jsonanswer = make_answer(jsonid);
    cJSON_AddItemToObject(jsonanswer, "result", jsonretval);

    return jsonanswer;
}

char *
call_ubus2json(const char *method, char *args) {
    spin_data sd;
    spin_data rpc, json_res, res;
    char *resultstr;
    static int nextid = 1;

    sd = cJSON_Parse(args);
    rpc = cJSON_CreateObject();
    cJSON_AddStringToObject(rpc, "jsonrpc", "2.0");
    cJSON_AddStringToObject(rpc, "method", method);
    cJSON_AddItemToObject(rpc, "params", sd);
    cJSON_AddNumberToObject(rpc, "id", ++nextid);

    json_res = rpc_json(rpc);

    res = cJSON_GetObjectItemCaseSensitive(json_res, "result");

    resultstr = cJSON_PrintUnformatted(res);

    cJSON_Delete(rpc);
    cJSON_Delete(json_res);

    return resultstr;
}