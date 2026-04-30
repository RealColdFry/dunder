local ____exports = {}
local function sumTo(n)
    local total = 0
    do
        local i = 0
        while true do
            do
                if not (i < n) then
                    break
                end
                total = total + i
            end
            ::____continue_0::
            i = i + 1
        end
    end
    return total
end
return ____exports
