local ____exports = {}
local function check(x, s)
    if x then
        return s
    end
    return (function()
        if not s then
            return "empty"
        else
            return "ok"
        end
    end)()
end
return ____exports
