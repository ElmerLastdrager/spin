#!/usr/bin/lua5.1

--
-- this modules allows applications to exchange data
-- with the SPIN kernel module
--
-- see <todo> for information about the data exchange
-- protocol


local posix = require "posix"
--local socket = require "socket"
local wirefmt = require "wirefmt"

local _M = {}

_M.MAX_NL_MSG_SIZE = 2048

--
-- Netlink functions
--
function _M.create_netlink_header(payload, 
                               type,
                               flags,
                               sequence,
                               pid)
	-- note: netlink headers are in the byte order of the host!
	local msg_size = string.len(payload) + 16
	return wirefmt.int32_system_endian(msg_size) ..
	       wirefmt.int16_system_endian(0) ..
	       wirefmt.int16_system_endian(0) ..
	       wirefmt.int32_system_endian(0) ..
	       wirefmt.int32_system_endian(pid)
end

-- returns a tuple of:
-- size of data
-- data sequence (as a string)
-- (type, flags, seq and pid are ignored for now)
function _M.read_netlink_message(sock_fd)
  -- read size first (it's in system endianness)
  local nlh, err = posix.recv(sock_fd, _M.MAX_NL_MSG_SIZE)
  if nlh == nil then
      print(err)
      return nil, err
  end
  local nl_size = wirefmt.bytes_to_int32_systemendian(nlh:byte(1,4))
  local nl_type = wirefmt.bytes_to_int16_systemendian(nlh:byte(5,6))
  local nl_flags = wirefmt.bytes_to_int16_systemendian(nlh:byte(7,8))
  local nl_seq = wirefmt.bytes_to_int32_systemendian(nlh:byte(9,12))
  local nl_pid = wirefmt.bytes_to_int32_systemendian(nlh:byte(13,16))
  return nlh:sub(17, nl_size)
end


--
-- Spin functions
--

_M.spin_message_types = {
    SPIN_TRAFFIC_DATA = 1,
	SPIN_DNS_ANSWER = 2,
	SPIN_BLOCKED = 3
}

local PktInfo = {}
PktInfo.__index = PktInfo

function _M.PktInfo_create()
  local p = {}
  setmetatable(p, PktInfo)
  p.family = nil
  p.protocol = nil
  p.src_addr = nil
  p.dest_addr = nil
  p.src_port = nil
  p.dest_port = nil
  p.payload_size = nil
  p.payload_offset = nil
  return p
end

function PktInfo:print()
    local ipv
    if self.family == posix.AF_INET then
      ipv = 4
    elseif self.family == posix.AF_INET6 then
      ipv = 6
    else
      ipv = "-unknown"
    end
	print("ipv" .. ipv ..
	      " protocol " .. self.protocol ..
	      " " .. self.src_addr ..
	      ":" .. self.src_port ..
	      " " .. self.dest_addr ..
	      ":" .. self.dest_port ..
	      " size " .. self.payload_size)
end

local DnsPktInfo = {}
DnsPktInfo.__index = DnsPktInfo

function _M.DnsPktInfo_create()
	local d = {}
	setmetatable(d, DnsPktInfo)
	d.family = 0
	d.ip = ""
	d.ttl = 0
	d.dname = ""
	return d
end

function DnsPktInfo:print()
    io.stdout:write(self.ip)
    io.stdout:write(" ")
    io.stdout:write(self.dname)
    io.stdout:write(" ")
    io.stdout:write(self.ttl)
    io.stdout:write("\n")
end

-- read wire format packet info
-- note: this format is in network byte order
function _M.read_spin_pkt_info(data)
	local pkt_info = _M.PktInfo_create()
	pkt_info.family = data:byte(1)
	pkt_info.protocol = data:byte(2)
	pkt_info.src_addr = ""
	pkt_info.dest_addr = ""
	if (pkt_info.family == posix.AF_INET) then
		pkt_info.src_addr = wirefmt.ntop_v4(data:sub(15,18))
		pkt_info.dest_addr = wirefmt.ntop_v4(data:sub(31,34))
	elseif (pkt_info.family == posix.AF_INET6) then
		pkt_info.src_addr = wirefmt.ntop_v6(data:sub(3,18))
		pkt_info.dest_addr = wirefmt.ntop_v6(data:sub(19,34))
	end
	pkt_info.src_port = wirefmt.bytes_to_int16_bigendian(data:byte(35,36))
	pkt_info.dest_port = wirefmt.bytes_to_int16_bigendian(data:byte(37,38))
	pkt_info.payload_size = wirefmt.bytes_to_int32_bigendian(data:byte(39,42))
	pkt_info.payload_offset = wirefmt.bytes_to_int16_bigendian(data:byte(43,44))
	return pkt_info
end

function _M.read_dns_pkt_info(data)
	local dns_pkt_info = _M.DnsPktInfo_create()
	dns_pkt_info.family = data:byte(1)
	if (dns_pkt_info.family == posix.AF_INET) then
		dns_pkt_info.ip = wirefmt.ntop_v4(data:sub(14, 17))
	elseif (dns_pkt_info.family == posix.AF_INET) then
		dns_pkt_info.ip = wirefmt.ntop_v6(data:sub(2, 17))
	end
	dns_pkt_info.ttl = wirefmt.bytes_to_int32_bigendian(data:byte(18, 21))
	local dname_size = data:byte(22)
	dns_pkt_info.dname = data:sub(23, 23 + dname_size - 1)
	return dns_pkt_info
end

function _M.spin_read_message_type(data)
	local spin_msg_type = data:byte(1)
	local spin_msg_size = wirefmt.bytes_to_int16_bigendian(data:byte(2,3))
	if spin_msg_type == _M.spin_message_types.SPIN_TRAFFIC_DATA then
	  io.stdout:write("[TRAFFIC] ")
	  local pkt_info = _M.read_spin_pkt_info(data:sub(4))
	  pkt_info:print()
	elseif spin_msg_type == _M.spin_message_types.SPIN_DNS_ANSWER then
	  io.stdout:write("[DNS] ")
	  local dns_pkt_info = _M.read_dns_pkt_info(data:sub(4))
	  dns_pkt_info:print()
	elseif spin_msg_type == _M.spin_message_types.SPIN_BLOCKED then
	  io.stdout:write("[BLOCKED] ")
	  local pkt_info = _M.read_spin_pkt_info(data:sub(4))
	  pkt_info:print()
	else
	  print("unknown spin message type: " .. type)
	end
end

function _M.get_process_id()
	local pid = posix.getpid()
	-- can be a table or an integer
	if (type(pid) == "table") then
		return pid["pid"]
	else
		return pid
	end
end

function _M.connect()
    print("connecting")
    local fd, err = posix.socket(posix.AF_NETLINK, posix.SOCK_DGRAM, 31)
    assert(fd, err)

    local ok, err = posix.bind(fd, { family = posix.AF_NETLINK,
                                     pid = 0,
                                     groups = 0 }) 
    assert(ok, err)
    if (not ok) then
        print("error")
        return nil, err
    end
    print("connected. fd: " .. fd)
    return fd
end

if posix.AF_NETLINK ~= nil then
	local fd, err = _M.connect()
	msg_str = "Hello!"
	hdr_str = _M.create_netlink_header(msg_str, 0, 0, 0, _M.get_process_id())
	
	posix.send(fd, hdr_str .. msg_str);

	while true do
	    local spin_msg = _M.read_netlink_message(fd)
            if spin_msg then
                _M.spin_read_message_type(spin_msg)
            else
                fd = _M.connect()
            end
	end
else
	print("no posix.AF_NETLINK")
end
