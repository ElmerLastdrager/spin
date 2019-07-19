typedef enum {
    RPCAT_INT,
    RPCAT_STRING,
    RPCAT_COMPLEX
} rpc_argtype;

typedef struct {
    char *      rpca_name;
    rpc_argtype rpca_type;
} rpc_arg_desc_t;

typedef union {
    int         rpca_ivalue;
    char *      rpca_svalue;
    spin_data   rpca_cvalue;
} rpc_arg_val_t;

typedef struct {
    rpc_arg_desc_t  rpc_desc;
    rpc_arg_val_t   rpc_val;
} rpc_arg_t;

typedef int (*rpc_func_p)(void *cb,rpc_arg_val_t *args, rpc_arg_val_t *result);

void rpc_register(char *name, rpc_func_p func, void *cb, int nargs, rpc_arg_desc_t *args, rpc_argtype result_type);
int rpc_call(char *name, int nargs, rpc_arg_t *args, rpc_arg_t *result);