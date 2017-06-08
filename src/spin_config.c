#include <sys/socket.h>
#include <sys/types.h>
#include <linux/netlink.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <arpa/inet.h>

#include <errno.h>

#include "pkt_info.h"
#include "spin_cfg.h"

#define NETLINK_CONFIG_PORT 30

#define MAX_PAYLOAD 1024 /* maximum payload size*/
struct sockaddr_nl src_addr, dest_addr;
struct nlmsghdr *nlh = NULL;
struct iovec iov;
int sock_fd;
struct msghdr msg;

int verbosity = 0;

typedef enum {
    IGNORE,
    BLOCK,
    EXCEPT
} cmd_types_t;

typedef enum {
    SHOW,
    ADD,
    REMOVE,
    CLEAR
} cmd_t;

void hexdump(uint8_t* data, unsigned int offset, unsigned int size) {
    unsigned int i;
    printf(" 0: ");
    for (i = 0; i < size; i++) {
        if (i > 0 && i%10 == 0) {
            printf("\n%02u: ", i);
        }
        printf("%02x ", (uint8_t) data[offset + i]);
    }
    printf("\n");
}

int send_command(size_t cmdbuf_size, unsigned char* cmdbuf)
{
    config_command_t cmd;

    sock_fd = socket(PF_NETLINK, SOCK_RAW, NETLINK_CONFIG_PORT);
    if(sock_fd<0) {
        fprintf(stderr, "Error connecting to socket: %s\n", strerror(errno));
        return -1;
    }

    memset(&src_addr, 0, sizeof(src_addr));
    src_addr.nl_family = AF_NETLINK;
    src_addr.nl_pid = getpid(); /* self pid */

    bind(sock_fd, (struct sockaddr*)&src_addr, sizeof(src_addr));

    memset(&dest_addr, 0, sizeof(dest_addr));
    memset(&dest_addr, 0, sizeof(dest_addr));
    dest_addr.nl_family = AF_NETLINK;
    dest_addr.nl_pid = 0; /* For Linux Kernel */
    dest_addr.nl_groups = 0; /* unicast */

    nlh = (struct nlmsghdr *)malloc(NLMSG_SPACE(MAX_PAYLOAD));
    memset(nlh, 0, NLMSG_SPACE(MAX_PAYLOAD));
    nlh->nlmsg_len = NLMSG_SPACE(MAX_PAYLOAD);
    nlh->nlmsg_pid = getpid();
    nlh->nlmsg_flags = 0;

    //strcpy(NLMSG_DATA(nlh), "Hello!");
    memcpy(NLMSG_DATA(nlh), cmdbuf, cmdbuf_size);

    iov.iov_base = (void *)nlh;
    iov.iov_len = nlh->nlmsg_len;
    msg.msg_name = (void *)&dest_addr;
    msg.msg_namelen = sizeof(dest_addr);
    msg.msg_iov = &iov;
    msg.msg_iovlen = 1;

    //printf("Sending message to kernel\n");
    sendmsg(sock_fd,&msg,0);
    //printf("Waiting for message from kernel\n");

    /* Read response message(s) */
    // Last message should always be SPIN_CMD_END with no data
    while (1) {
        recvmsg(sock_fd, &msg, 0);
        cmd = ((uint8_t*)NLMSG_DATA(nlh))[0];

        if (cmd == SPIN_CMD_END) {
            break;
        } else if (cmd == SPIN_CMD_ERR) {
            //printf("Received message payload: %s\n", (char *)NLMSG_DATA(nlh));
            pkt_info_t pkt;
            char err_str[MAX_PAYLOAD];
            strncpy(err_str, (char *)NLMSG_DATA(nlh) + 1, MAX_PAYLOAD);
            printf("Error message from kernel: %s\n", err_str);
        } else if (cmd == SPIN_CMD_IP) {
            // TODO: check message size
            // first octet is ip version (AF_INET or AF_INET6)
            uint8_t ipv = ((uint8_t*)NLMSG_DATA(nlh))[1];
            unsigned char ip_str[INET6_ADDRSTRLEN];
            inet_ntop(ipv, NLMSG_DATA(nlh) + 2, ip_str, INET6_ADDRSTRLEN);
            printf("%s\n", ip_str);
        } else {
            printf("unknown command response type received from kernel (%u), stopping\n", cmd);
            hexdump((uint8_t*)NLMSG_DATA(nlh), 0, nlh->nlmsg_len);
            break;
        }
    }
    close(sock_fd);
}

void help(int rcode) {
    printf("Usage: spin_config <type> <command> [address] [options]\n");
    printf("Types:\n");
    printf("- ignore: show or modify the list of addresses that are ignored\n");
    printf("- block:  show or modify the list of addresses that are blocked\n");
    printf("- except: show or modify the list of addresses that are not blocked\n");
    printf("Commands:\n");
    printf("- show:   show the addresses in the list\n");
    printf("- add:    add address to list\n");
    printf("- remove: remove address from list\n");
    printf("- clear:  remove all addresses from list\n");
    printf("If no options are given, show all lists\n");
    exit(rcode);
}

void execute_no_arg(cmd_types_t type, cmd_t cmd) {
    unsigned char cmdbuf[1];
    switch (type) {
    case IGNORE:
        switch (cmd) {
        case SHOW:
            cmdbuf[0] = SPIN_CMD_GET_IGNORE;
            break;
        case CLEAR:
            cmdbuf[0] = SPIN_CMD_CLEAR_IGNORE;
            break;
        }
        break;
    case BLOCK:
        switch (cmd) {
        case SHOW:
            cmdbuf[0] = SPIN_CMD_GET_BLOCK;
            break;
        case CLEAR:
            cmdbuf[0] = SPIN_CMD_CLEAR_BLOCK;
            break;
        }
        break;
    case EXCEPT:
        switch (cmd) {
        case SHOW:
            cmdbuf[0] = SPIN_CMD_GET_EXCEPT;
            break;
        case CLEAR:
            cmdbuf[0] = SPIN_CMD_CLEAR_EXCEPT;
            break;
        }
        break;
    }
    send_command(1, cmdbuf);
}

void execute_arg(cmd_types_t type, cmd_t cmd, const char* ip_str) {
    unsigned char cmdbuf[18];
    size_t cmdsize = 18;

    switch (type) {
    case IGNORE:
        switch (cmd) {
        case ADD:
            cmdbuf[0] = SPIN_CMD_ADD_IGNORE;
            break;
        case REMOVE:
            cmdbuf[0] = SPIN_CMD_REMOVE_IGNORE;
            break;
        }
        break;
    case BLOCK:
        switch (cmd) {
        case ADD:
            cmdbuf[0] = SPIN_CMD_ADD_BLOCK;
            break;
        case REMOVE:
            cmdbuf[0] = SPIN_CMD_REMOVE_BLOCK;
            break;
        }
        break;
    case EXCEPT:
        switch (cmd) {
        case ADD:
            cmdbuf[0] = SPIN_CMD_ADD_EXCEPT;
            break;
        case REMOVE:
            cmdbuf[0] = SPIN_CMD_REMOVE_EXCEPT;
            break;
        }
    }

    if (inet_pton(AF_INET6, ip_str, cmdbuf+2) == 1) {
        cmdbuf[1] = AF_INET6;
    } else if (inet_pton(AF_INET, ip_str, cmdbuf+2) == 1) {
        cmdbuf[1] = AF_INET;
        cmdsize = 6;
    }

    send_command(cmdsize, cmdbuf);
}

void show_all_lists() {};

int main(int argc, char** argv) {
    // first option is type: ignore, block, exceptions, no option is list all
    // section option is command: list, add, remove, clear
    // third option depends on previous (optional ip address)
    cmd_types_t type;
    cmd_t cmd;
    int i;
    unsigned char buf[sizeof(struct in6_addr)];

    if (argc == 1) {
        show_all_lists();
        exit(0);
    }
    if (argc < 3) {
        help(1);
    }

    if (strncmp(argv[1], "ignore", 7) == 0) {
        type = IGNORE;
    } else if (strncmp(argv[1], "block", 6) == 0) {
        type = BLOCK;
    } else if (strncmp(argv[1], "except", 7) == 0) {
        type = EXCEPT;
    } else if (strncmp(argv[1], "-h", 3) == 0) {
        help(0);
    } else if (strncmp(argv[1], "-help", 6) == 0) {
        help(0);
    } else {
        printf("unknown command type %s; must be one of 'ignore', 'block' or 'except'\n");
        return 1;
    }

    if (strncmp(argv[2], "show", 5) == 0) {
        cmd = SHOW;
    } else if (strncmp(argv[2], "add", 4) == 0) {
        cmd = ADD;
    } else if (strncmp(argv[2], "remove", 7) == 0) {
        cmd = REMOVE;
    } else if (strncmp(argv[2], "clear", 6) == 0) {
        cmd = CLEAR;
    } else if (strncmp(argv[2], "-h", 3) == 0) {
        help(0);
    } else if (strncmp(argv[2], "-help", 6) == 0) {
        help(0);
    } else {
        printf("unknown command type %s; must be one of 'ignore', 'block' or 'except'\n");
        return 1;
    }

    if (cmd == SHOW || cmd == CLEAR) {
        if (argc > 3) {
            printf("Extraneous argument; show and clear take no address\n");
            exit(1);
        }
        execute_no_arg(type, cmd);
    }
    if (cmd == ADD || cmd == REMOVE) {
        if (argc < 4) {
            printf("Missing argument(s); add and remove take IP addresses\n");
            exit(1);
        }
        // check all addresses
        for (i = 3; i < argc; i++) {
            if (inet_pton(AF_INET6, argv[i], buf) < 1 &&
                inet_pton(AF_INET, argv[i], buf) < 1) {
                printf("Bad IP address: %s, not executing command(s)\n", argv[i]);
                exit(1);
            }
        }
        for (i = 3; i < argc; i++) {
            execute_arg(type, cmd, argv[i]);
        }
    }

    // check all given addresses
    return 0;
}